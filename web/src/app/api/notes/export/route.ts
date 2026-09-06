import { PassThrough } from 'node:stream';
import { ZipArchive } from 'archiver';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ExportNote = {
  id: string;
  parent_note_id: string | null;
  title: string;
  body_markdown: string;
  sort_key: number;
  ai_excluded: boolean;
  created_at: string;
  updated_at: string;
};

type ExportAttachment = {
  id: string;
  note_id: string;
  object_key: string;
  original_name: string;
  media_type: string;
  byte_size: number;
  checksum_sha256: string;
};

function safeFileStem(value: string) {
  const normalized = value
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .trim();
  return (normalized.replace(/\s+/g, ' ').slice(0, 120) || 'Untitled Note').replace(
    /^\.+$/,
    'Untitled Note'
  );
}

function markdownNote(note: ExportNote) {
  const frontmatter = [
    '---',
    'planner_ai_export: 1',
    `planner_ai_note_id: ${note.id}`,
    `planner_ai_parent_note_id: ${note.parent_note_id ?? ''}`,
    `planner_ai_sort_key: ${note.sort_key}`,
    `planner_ai_ai_excluded: ${note.ai_excluded}`,
    `planner_ai_created_at: ${note.created_at}`,
    `planner_ai_updated_at: ${note.updated_at}`,
    '---',
    '',
  ].join('\n');
  return `${frontmatter}${note.body_markdown}${note.body_markdown.endsWith('\n') ? '' : '\n'}`;
}

function safeAttachmentName(value: string) {
  const normalized = value
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .trim();
  return (normalized.replace(/\s+/g, ' ').slice(0, 180) || 'attachment').replace(
    /^\.+$/,
    'attachment'
  );
}

export async function zipNotes(notes: ExportNote[], attachments: ExportAttachment[]) {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);

  const seen = new Map<string, number>();
  const manifest = notes.map((note) => {
    const stem = safeFileStem(note.title);
    const duplicate = seen.get(stem) ?? 0;
    seen.set(stem, duplicate + 1);
    const path = `Notes/${stem}${duplicate ? ` ${duplicate + 1}` : ''}.md`;
    archive.append(markdownNote(note), { name: path });
    return {
      id: note.id,
      parentNoteId: note.parent_note_id,
      path,
      title: note.title,
      sortKey: note.sort_key,
    };
  });
  const attachmentManifest = [] as Array<{
    id: string;
    noteId: string;
    path: string;
    originalName: string;
    mediaType: string;
    byteSize: number;
    checksumSha256: string;
  }>;
  const storage = createAdminClient().storage.from('note-attachments');
  for (const attachment of attachments) {
    const { data, error } = await storage.download(attachment.object_key);
    if (error || !data) throw new Error('Attachment export failed.');
    const path = `Attachments/${attachment.note_id}/${attachment.id}-${safeAttachmentName(attachment.original_name)}`;
    archive.append(Buffer.from(await data.arrayBuffer()), { name: path });
    attachmentManifest.push({
      id: attachment.id,
      noteId: attachment.note_id,
      path,
      originalName: attachment.original_name,
      mediaType: attachment.media_type,
      byteSize: attachment.byte_size,
      checksumSha256: attachment.checksum_sha256,
    });
  }
  archive.append(
    JSON.stringify(
      {
        format: 'planner-ai-notes-vault',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        notes: manifest,
        attachments: attachmentManifest,
      },
      null,
      2
    ),
    { name: 'planner-ai-vault.json' }
  );
  await archive.finalize();
  return completed;
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
      .select('id,note_id,object_key,original_name,media_type,byte_size,checksum_sha256')
      .eq('workspace_id', workspace.id)
      .eq('scan_state', 'approved')
      .is('removed_at', null)
      .order('created_at'),
  ]);
  if (notesResult.error || attachmentsResult.error)
    return NextResponse.json({ error: 'Planner AI could not read your Notes.' }, { status: 500 });

  try {
    const archive = await zipNotes(
      (notesResult.data ?? []) as ExportNote[],
      (attachmentsResult.data ?? []) as ExportAttachment[]
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
