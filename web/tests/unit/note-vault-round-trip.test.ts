import { describe, expect, it } from 'vitest';
import { candidatesFromVaultOrFiles, filesFromZip } from '@/lib/notes/import-bundle';
import { zipNotes, type ExportNote } from '@/lib/notes/export-vault';

const noAttachments = () => Promise.reject(new Error('No attachment was expected.'));

function note(index: number, overrides: Partial<ExportNote> = {}): ExportNote {
  const id = `${String(index).repeat(8)}-1111-1111-1111-111111111111`.slice(0, 36);
  return {
    id,
    parent_note_id: null,
    title: `Note ${index}`,
    body_markdown: `Body ${index}`,
    sort_key: index * 1000,
    ai_excluded: false,
    created_at: '2026-09-06T00:00:00.000Z',
    updated_at: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

async function roundTrip(notes: ExportNote[]) {
  const archive = await zipNotes(notes, [], noAttachments);
  return candidatesFromVaultOrFiles(await filesFromZip(archive));
}

describe('Notes vault export/import round trip', () => {
  it('preserves every Note body through a full export and re-import', async () => {
    const notes = [
      note(1, { body_markdown: '# Heading\n\nParagraph with **bold** and `code`.' }),
      note(2, { body_markdown: '- [ ] open task\n- [x] done task' }),
      note(3, { body_markdown: '| a | b |\n| --- | --- |\n| 1 | 2 |' }),
      note(4, { body_markdown: 'Body with a --- thematic break\n\n---\n\nAfter the break.' }),
      note(5, { body_markdown: 'Unicode: café — naïve — 日本語 — 🌱' }),
    ];

    const candidates = await roundTrip(notes);

    expect(candidates).toHaveLength(notes.length);
    for (const source of notes) {
      const restored = candidates.find((item) => item.sourcePath.endsWith(source.id));
      expect(restored, `Note ${source.title} survived the round trip`).toBeDefined();
      expect(restored!.title).toBe(source.title);
      expect(restored!.bodyMarkdown).toBe(source.body_markdown);
      expect(restored!.unsupportedReason).toBeNull();
    }
  });

  it('preserves AI Exclusion so a restored Note is not returned to retrieval', async () => {
    const candidates = await roundTrip([
      note(1, { title: 'Excluded', ai_excluded: true }),
      note(2, { title: 'Included', ai_excluded: false }),
    ]);

    expect(candidates.find((item) => item.title === 'Excluded')!.aiExcluded).toBe(true);
    expect(candidates.find((item) => item.title === 'Included')!.aiExcluded).toBe(false);
  });

  it('preserves hierarchy when a child Note is exported before its parent', async () => {
    const parent = note(1, { title: 'Parent' });
    const child = note(2, { title: 'Child', parent_note_id: parent.id });

    const candidates = await roundTrip([child, parent]);

    const restoredChild = candidates.find((item) => item.title === 'Child');
    const restoredParent = candidates.find((item) => item.title === 'Parent');
    expect(restoredParent!.parentSourcePath).toBeNull();
    expect(restoredChild!.parentSourcePath).toBe(restoredParent!.sourcePath);
  });

  it('keeps Notes distinct when a title collides with a de-duplicated filename', async () => {
    const notes = [
      note(1, { title: 'Weekly Review', body_markdown: 'First body.' }),
      note(2, { title: 'Weekly Review', body_markdown: 'Second body.' }),
      note(3, { title: 'Weekly Review 2', body_markdown: 'Third body.' }),
    ];

    const candidates = await roundTrip(notes);

    expect(candidates).toHaveLength(3);
    expect(candidates.map((item) => item.bodyMarkdown).sort()).toEqual([
      'First body.',
      'Second body.',
      'Third body.',
    ]);
  });
});
