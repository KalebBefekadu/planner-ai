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
  /* Appearance and favourites are presentation metadata, deliberately kept
     beside the Markdown rather than inside it -- but they are still the owner's
     choices. A vault that restores every word and none of the icons, covers or
     pinned pages has not restored the workspace; it has restored the text and
     quietly discarded how the person arranged it. */
  icon_emoji: string | null;
  cover_key: string | null;
  cover_position: number;
  favorited_at: string | null;
};

export type ExportAttachment = {
  id: string;
  note_id: string;
  object_key: string;
  original_name: string;
  media_type: string;
  byte_size: number;
  checksum_sha256: string;
  scan_state: string;
};

// An export must never quietly contain less than the workspace holds. A file
// that cannot be written into the archive is reported instead of skipped, so
// the downloader answers with the reason rather than throwing it away.
export type AttachmentExportResult =
  | { available: true; bytes: Buffer }
  | { available: false; reason: 'rejected' | 'missing' };

export type ExportNoteTag = {
  note_id: string;
  name: string;
};

export type ExportNoteLink = {
  source_note_id: string;
  target_note_id: string;
  relation_type: string;
};

// Tags and Note-to-Note links live in their own tables, so a vault that only
// walks `notes` loses them entirely. They are carried alongside the Notes
// rather than inside them so the manifest stays the single index of the vault.
export type ExportRelations = {
  tags?: ExportNoteTag[];
  links?: ExportNoteLink[];
};

type AttachmentDownloader = (attachment: ExportAttachment) => Promise<AttachmentExportResult>;

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

function markdownNote(note: ExportNote, tags: string[]) {
  const frontmatter = [
    '---',
    'planner_ai_export: 1',
    `planner_ai_note_id: ${note.id}`,
    `planner_ai_parent_note_id: ${note.parent_note_id ?? ''}`,
    `planner_ai_sort_key: ${note.sort_key}`,
    `planner_ai_ai_excluded: ${note.ai_excluded}`,
    // Tags are written into the file itself as well as the manifest so the
    // owner still sees them when the vault is opened in a plain Markdown
    // editor that knows nothing about Planner AI's manifest.
    `planner_ai_tags: ${tags.join(', ')}`,
    `planner_ai_created_at: ${note.created_at}`,
    `planner_ai_updated_at: ${note.updated_at}`,
    '---',
    '',
  ].join('\n');
  // The body is written verbatim. Appending a trailing newline would make a
  // re-imported vault differ from its source by one character, so exact
  // duplicate detection would report every restored Note as new.
  return `${frontmatter}${note.body_markdown}`;
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
  downloadAttachment: AttachmentDownloader,
  relations: ExportRelations = {}
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

  // Reserve each generated filename. Counting title stems alone is not enough:
  // a Note genuinely titled "Report 2" collides with the name generated for a
  // second Note titled "Report", which would drop one body from the archive.
  const takenPaths = new Set<string>();
  const exportedIds = new Set(notes.map((note) => note.id));
  const tagsByNote = new Map<string, string[]>();
  for (const tag of relations.tags ?? []) {
    if (!exportedIds.has(tag.note_id)) continue;
    tagsByNote.set(tag.note_id, [...(tagsByNote.get(tag.note_id) ?? []), tag.name]);
  }
  const manifest = notes.map((note) => {
    const stem = safeFileStem(note.title);
    let path = `Notes/${stem}.md`;
    for (let suffix = 2; takenPaths.has(path); suffix += 1) {
      path = `Notes/${stem} ${suffix}.md`;
    }
    takenPaths.add(path);
    const tags = [...(tagsByNote.get(note.id) ?? [])].sort();
    archive.append(markdownNote(note, tags), { name: path });
    return {
      id: note.id,
      parentNoteId: note.parent_note_id,
      path,
      title: note.title,
      sortKey: note.sort_key,
      aiExcluded: note.ai_excluded,
      iconEmoji: note.icon_emoji,
      coverKey: note.cover_key,
      coverPosition: note.cover_position,
      favoritedAt: note.favorited_at,
      createdAt: note.created_at,
      updatedAt: note.updated_at,
      tags,
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
  const unavailableAttachments = [] as Array<{
    id: string;
    noteId: string;
    originalName: string;
    mediaType: string;
    byteSize: number;
    checksumSha256: string;
    reason: 'rejected' | 'missing';
  }>;
  for (const attachment of attachments) {
    const result = await downloadAttachment(attachment);
    if (!result.available) {
      unavailableAttachments.push({
        id: attachment.id,
        noteId: attachment.note_id,
        originalName: attachment.original_name,
        mediaType: attachment.media_type,
        byteSize: attachment.byte_size,
        checksumSha256: attachment.checksum_sha256,
        reason: result.reason,
      });
      continue;
    }
    const path = `Attachments/${attachment.note_id}/${attachment.id}-${safeAttachmentName(attachment.original_name)}`;
    archive.append(result.bytes, { name: path });
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
        unavailableAttachments,
        // A link whose target was not exported (trashed, archived) would
        // describe a Note the vault cannot rebuild, so it is dropped rather
        // than restored as a dangling edge.
        links: (relations.links ?? [])
          .filter(
            (link) => exportedIds.has(link.source_note_id) && exportedIds.has(link.target_note_id)
          )
          .map((link) => ({
            sourceNoteId: link.source_note_id,
            targetNoteId: link.target_note_id,
            relationType: link.relation_type,
          })),
      },
      null,
      2
    ),
    { name: 'planner-ai-vault.json' }
  );
  if (unavailableAttachments.length) {
    archive.append(
      [
        'Some files attached to your Notes are not in this export.',
        '',
        ...unavailableAttachments.map(
          (attachment) =>
            `- ${attachment.originalName} (${attachment.byteSize} bytes) - ${
              attachment.reason === 'missing'
                ? 'the stored file is no longer in storage'
                : 'the file contents did not match its declared type, so it was never made available'
            }`
        ),
        '',
        'Their details are recorded under "unavailableAttachments" in planner-ai-vault.json.',
        '',
      ].join('\n'),
      { name: 'Attachments/UNAVAILABLE.txt' }
    );
  }
  await archive.finalize();
  return completed;
}
