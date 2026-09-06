import yauzl from 'yauzl';
import { describe, expect, it } from 'vitest';
import { zipNotes } from '@/lib/notes/export-vault';

function entriesFromZip(archive: Buffer) {
  return new Promise<Map<string, Buffer>>((resolve, reject) => {
    yauzl.fromBuffer(archive, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) return reject(openError ?? new Error('Archive could not be read.'));
      const entries = new Map<string, Buffer>();
      zip.on('error', reject);
      zip.on('entry', (entry) => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream)
            return reject(streamError ?? new Error('Entry could not be read.'));
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(entries));
      zip.readEntry();
    });
  });
}

describe('Notes vault export', () => {
  it('includes approved attachment bytes and portable manifest metadata', async () => {
    const noteId = '11111111-1111-1111-1111-111111111111';
    const attachmentId = '22222222-2222-2222-2222-222222222222';
    const attachmentBytes = Buffer.from('private, approved evidence');
    const archive = await zipNotes(
      [
        {
          id: noteId,
          parent_note_id: null,
          title: 'Decision record',
          body_markdown: '# Decision\n\nKeep the evidence.',
          sort_key: 1000,
          ai_excluded: false,
          created_at: '2026-09-06T00:00:00.000Z',
          updated_at: '2026-09-06T00:00:00.000Z',
        },
      ],
      [
        {
          id: attachmentId,
          note_id: noteId,
          object_key: `${noteId}/${noteId}/${attachmentId}`,
          original_name: 'evidence.pdf',
          media_type: 'application/pdf',
          byte_size: attachmentBytes.byteLength,
          checksum_sha256: 'a'.repeat(64),
        },
      ],
      async () => attachmentBytes
    );
    const entries = await entriesFromZip(archive);
    const attachmentPath = `Attachments/${noteId}/${attachmentId}-evidence.pdf`;

    expect(entries.get(attachmentPath)).toEqual(attachmentBytes);
    expect(JSON.parse(entries.get('planner-ai-vault.json')!.toString('utf8'))).toMatchObject({
      format: 'planner-ai-notes-vault',
      schemaVersion: 1,
      attachments: [
        {
          id: attachmentId,
          noteId,
          path: attachmentPath,
          originalName: 'evidence.pdf',
          mediaType: 'application/pdf',
          byteSize: attachmentBytes.byteLength,
          checksumSha256: 'a'.repeat(64),
        },
      ],
    });
  });
});
