import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
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
    .select('object_key,original_name,media_type,scan_state')
    .eq('id', attachmentId)
    .eq('workspace_id', workspace.id)
    .is('removed_at', null)
    .maybeSingle();
  if (!attachment) return error('Attachment not found.', 404);
  if (attachment.scan_state !== 'approved') {
    return error('This attachment is not available until security review is complete.', 409);
  }
  const { data, error: downloadError } = await createAdminClient()
    .storage.from(bucket)
    .download(attachment.object_key);
  if (downloadError || !data) return error('Attachment download could not be completed.', 503);
  return new NextResponse(data, {
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
    const attachmentId = randomUUID();
    const objectKey = `${workspace.id}/${note.id}/${attachmentId}`;
    const admin = createAdminClient();
    const { error: uploadError } = await admin.storage.from(bucket).upload(objectKey, bytes, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) return error('Attachment upload could not be completed.', 503);
    const { data: attachment, error: insertError } = await admin
      .from('note_attachments')
      .insert({
        id: attachmentId,
        workspace_id: workspace.id,
        note_id: note.id,
        object_key: objectKey,
        original_name: file.name.slice(0, 255) || 'Untitled attachment',
        media_type: file.type,
        byte_size: file.size,
        checksum_sha256: createHash('sha256').update(bytes).digest('hex'),
        scan_state: 'quarantined',
      })
      .select('id,original_name,byte_size,scan_state')
      .single();
    if (insertError || !attachment) {
      await admin.storage.from(bucket).remove([objectKey]);
      return error('Attachment metadata could not be saved.', 503);
    }
    return NextResponse.json(
      { attachment },
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
      .select('id,object_key')
      .eq('id', body.attachmentId)
      .eq('workspace_id', workspace.id)
      .is('removed_at', null)
      .maybeSingle();
    if (!attachment) return error('Attachment not found.', 404);

    const admin = createAdminClient();
    const { error: storageError } = await admin.storage
      .from(bucket)
      .remove([attachment.object_key]);
    if (storageError) return error('Attachment removal could not be completed.', 503);
    const { error: updateError } = await admin
      .from('note_attachments')
      .update({ removed_at: new Date().toISOString() })
      .eq('id', attachment.id)
      .eq('workspace_id', workspace.id)
      .is('removed_at', null);
    if (updateError) return error('Attachment removal could not be completed.', 503);
    return new NextResponse(null, {
      status: 204,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return error('Attachment removal could not be completed.', 400);
  }
}
