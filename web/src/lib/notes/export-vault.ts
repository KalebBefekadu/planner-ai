import { PassThrough } from 'node:stream';
import * as archiverModule from 'archiver';
import type { ZipArchive } from 'archiver';

export type ExportNote = {
  id: string;
  parent_note_id: string | null;
  title: string;
  body_markdown: string;
  sort_key: number;
  ai_excluded: boolean;
  created_at: string;
  updated_at: string;
};

export type ExportAttachment = {
  id: string;
  note_id: string;
  object_key: string;
  original_name: string;
  media_type: string;
  byte_size: number;
  checksum_sha256: string;
};

type AttachmentDownloader = (objectKey: string) => Promise<Buffer>;

const createZipArchive = (
  archiverModule as unknown as {
    default: (format: 'zip', options: { zlib: { level: number } }) => ZipArchive;
  }
).default;

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

export async function zipNotes(
  notes: ExportNote[],
  attachments: ExportAttachment[],
  downloadAttachment: AttachmentDownloader
) {
  const archive = createZipArchive('zip', { zlib: { level: 9 } });
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
  for (const attachment of attachments) {
    const path = `Attachments/${attachment.note_id}/${attachment.id}-${safeAttachmentName(attachment.original_name)}`;
    archive.append(await downloadAttachment(attachment.object_key), { name: path });
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
