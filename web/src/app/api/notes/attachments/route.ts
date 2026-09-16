import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { resolveAttachment } from '@/lib/notes/attachment-availability';
import { attachmentTypeLabel, verifyAttachmentContent } from '@/lib/notes/attachment-content';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bucket = 'note-attachments';
const maxBytes = 10 * 1024 * 1024;
const maxMultipartBytes = maxBytes + 64 * 1024;
const acceptedTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'text/markdown',
  'text/plain',
]);
function error(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

function downloadName(name: string) {
  return (
    name
      .replace(/[\\/\r\n"]/g, ' ')
      .trim()
      .slice(0, 180) || 'attachment'
  ).replace(/^\.+$/, 'attachment');
}

export async function GET(request: Request) {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    return error('Notes attachments are unavailable before data migration.', 503);
  }
  const attachmentId = new URL(request.url).searchParams.get('attachmentId');
  if (!attachmentId) return error('Choose an attachment to download.', 400);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return error('Authentication required.', 401);
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', user.id)
    .single();
  if (!workspace) return error('Workspace is unavailable.', 503);
  const { data: attachment } = await supabase
    .from('note_attachments')
    .select('id,object_key,original_name,media_type,checksum_sha256,scan_state')
    .eq('id', attachmentId)
    .eq('workspace_id', workspace.id)
    .is('removed_at', null)
    .maybeSingle();
  if (!attachment) return error('Attachment not found.', 404);
  const resolved = await resolveAttachment(supabase, attachment);
  if (resolved.state === 'rejected') {
    return error(
      `This file is not available: its contents do not match a ${attachmentTypeLabel(attachment.media_type)}.`,
      409
    );
  }
  // The row promised a file and the storage object is not there. Saying so is
  // the only honest answer; a retry suggestion would be a guess.
  if (resolved.state === 'missing') {
    return error('This file is no longer in storage and cannot be recovered.', 410);
  }
  return new NextResponse(new Uint8Array(resolved.bytes), {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${downloadName(attachment.original_name)}"`,
      'Content-Type': attachment.media_type,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function POST(request: Request) {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    return error('Notes attachments are unavailable before data migration.', 503);
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return error('Authentication required.', 401);
  if (
    !(request.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')
  ) {
    return error('Choose a supported file.', 415);
  }
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0 ||
    contentLength > maxMultipartBytes
  ) {
    return error('Attachment upload exceeds 10 MB.', 413);
  }

  try {
    const form = await request.formData();
    const noteId = form.get('noteId');
    const file = form.get('file');
    if (typeof noteId !== 'string' || !(file instanceof File))
      return error('Choose a Note and file.', 400);
    if (!acceptedTypes.has(file.type) || file.size < 1 || file.size > maxBytes) {
      return error('Choose a PDF, PNG, JPEG, Markdown, or text file up to 10 MB.', 400);
    }
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id')
      .eq('owner_user_id', user.id)
      .single();
    if (!workspace) return error('Workspace is unavailable.', 503);
    const { data: note } = await supabase
      .from('notes')
      .select('id')
      .eq('id', noteId)
      .eq('workspace_id', workspace.id)
      .is('archived_at', null)
      .is('trashed_at', null)
      .maybeSingle();
    if (!note) return error('Note not found.', 404);

    const bytes = Buffer.from(await file.arrayBuffer());
    // The declared type comes from the filename the browser was given, so it is
    // checked against the bytes here rather than trusted. A file that fails is
    // still stored and still listed: the person can see what they uploaded and
    // remove it, but it is never served back under a type it does not have.
    const scanState = verifyAttachmentContent(file.type, bytes);
    const originalName = file.name.slice(0, 255) || 'Untitled attachment';

    // Reserve first. The reservation is what authorizes writing this one
    // object key, and it is also what makes a failure after the upload
    // recoverable: the row is still there for the purge job to reconcile
    // instead of an object nothing points at.
    const { data: reservation, error: reserveError } = await supabase.rpc(
      'reserve_note_attachment',
      {
        p_note_id: note.id,
        p_original_name: originalName,
        p_media_type: file.type,
        p_byte_size: file.size,
        p_checksum_sha256: createHash('sha256').update(bytes).digest('hex'),
        p_scan_state: scanState,
      }
    );
    const reserved = reservation as { attachmentId?: string; objectKey?: string } | null;
    if (reserveError || !reserved?.attachmentId || !reserved.objectKey) {
      return error('Attachment upload could not be completed.', 503);
    }

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(reserved.objectKey, bytes, { contentType: file.type, upsert: false });
    if (uploadError) {
      await supabase.rpc('abandon_note_attachment', { p_attachment_id: reserved.attachmentId });
      return error('Attachment upload could not be completed.', 503);
    }

    const { error: finalizeError } = await supabase.rpc('finalize_note_attachment', {
      p_attachment_id: reserved.attachmentId,
    });
    if (finalizeError) return error('Attachment metadata could not be saved.', 503);

    return NextResponse.json(
      {
        attachment: {
          id: reserved.attachmentId,
          original_name: originalName,
          byte_size: file.size,
          scan_state: scanState,
        },
      },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch {
    return error('Attachment upload could not be completed.', 400);
  }
}

export async function DELETE(request: Request) {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    return error('Notes attachments are unavailable before data migration.', 503);
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return error('Authentication required.', 401);

  try {
    const body = (await request.json()) as { attachmentId?: unknown };
    if (typeof body.attachmentId !== 'string') return error('Choose an attachment to remove.', 400);
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id')
      .eq('owner_user_id', user.id)
      .single();
    if (!workspace) return error('Workspace is unavailable.', 503);
    const { data: attachment } = await supabase
      .from('note_attachments')
      .select('id')
      .eq('id', body.attachmentId)
      .eq('workspace_id', workspace.id)
      .is('removed_at', null)
      .maybeSingle();
    if (!attachment) return error('Attachment not found.', 404);

    // Retention is decided in the database, so a request cannot ask for a
    // purge date of its own choosing.
    const { data: purgeAfter, error: removeError } = await supabase.rpc('remove_note_attachment', {
      p_attachment_id: attachment.id,
    });
    if (removeError || !purgeAfter) {
      return error('Attachment removal could not be completed.', 503);
    }
    return NextResponse.json(
      { attachmentId: attachment.id, purgeAfter: new Date(String(purgeAfter)).toISOString() },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch {
    return error('Attachment removal could not be completed.', 400);
  }
}

export async function PATCH(request: Request) {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    return error('Notes attachments are unavailable before data migration.', 503);
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return error('Authentication required.', 401);

  try {
    const body = (await request.json()) as { attachmentId?: unknown };
    if (typeof body.attachmentId !== 'string')
      return error('Choose an attachment to restore.', 400);
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id')
      .eq('owner_user_id', user.id)
      .single();
    if (!workspace) return error('Workspace is unavailable.', 503);
    const now = new Date().toISOString();
    const { data: attachment } = await supabase
      .from('note_attachments')
      .select('id')
      .eq('id', body.attachmentId)
      .eq('workspace_id', workspace.id)
      .not('removed_at', 'is', null)
      .gt('purge_after', now)
      .maybeSingle();
    if (!attachment) return error('This attachment can no longer be restored.', 404);
    const { error: restoreError } = await supabase.rpc('restore_note_attachment', {
      p_attachment_id: attachment.id,
    });
    if (restoreError) return error('Attachment restoration could not be completed.', 503);
    return new NextResponse(null, {
      status: 204,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return error('Attachment restoration could not be completed.', 400);
  }
}
