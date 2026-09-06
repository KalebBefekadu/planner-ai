import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bucket = 'note-attachments';
const maxBytes = 10 * 1024 * 1024;
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
