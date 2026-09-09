import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveAttachment } from '@/lib/notes/attachment-availability';
import {
  type AttachmentExportResult,
  type ExportAttachment,
  type ExportNote,
  zipNotes,
} from '@/lib/notes/export-vault';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function exportAttachment(attachment: ExportAttachment): Promise<AttachmentExportResult> {
  const resolved = await resolveAttachment(createAdminClient(), attachment);
  return resolved.state === 'approved'
    ? { available: true, bytes: resolved.bytes }
    : { available: false, reason: resolved.state };
}

export async function GET() {
  const supabase = await createClient();
  const [userResult, assuranceResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  const user = userResult.data.user;
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    return NextResponse.json(
      { error: 'Notes export is unavailable before data migration.' },
      { status: 503 }
    );
  }
  if (assuranceResult.data?.currentLevel !== 'aal2') {
    return NextResponse.json(
      { error: 'Verify this session in Security before exporting.' },
      { status: 403 }
    );
  }
  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', user.id)
    .single();
  if (workspaceError || !workspace) {
    return NextResponse.json({ error: 'Workspace is unavailable.' }, { status: 503 });
  }
  const [notesResult, attachmentsResult] = await Promise.all([
    supabase
      .from('notes')
      .select('id,parent_note_id,title,body_markdown,sort_key,ai_excluded,created_at,updated_at')
      .eq('workspace_id', workspace.id)
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('sort_key'),
    supabase
      .from('note_attachments')
      .select('id,note_id,object_key,original_name,media_type,byte_size,checksum_sha256,scan_state')
      .eq('workspace_id', workspace.id)
      .is('removed_at', null)
      .order('created_at'),
  ]);
  if (notesResult.error || attachmentsResult.error)
    return NextResponse.json({ error: 'Planner AI could not read your Notes.' }, { status: 500 });

  try {
    const archive = await zipNotes(
      (notesResult.data ?? []) as ExportNote[],
      (attachmentsResult.data ?? []) as ExportAttachment[],
      exportAttachment
    );
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(archive), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="planner-ai-notes-${date}.zip"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Planner AI could not create this Notes export.' },
      { status: 500 }
    );
  }
}
