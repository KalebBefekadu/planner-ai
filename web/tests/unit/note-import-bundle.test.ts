import { describe, expect, it } from 'vitest';
import { candidatesFromFiles, candidatesFromVaultOrFiles } from '@/lib/notes/import-bundle';

describe('Notes import bundle', () => {
  it('preserves Markdown and builds folder hierarchy', () => {
    const candidates = candidatesFromFiles([
      { path: 'Projects/Launch.md', bytes: Buffer.from('# Launch\n\nExact body.  ') },
    ]);
    expect(candidates).toEqual([
      {
        sourcePath: 'Projects/',
        title: 'Projects',
        bodyMarkdown: '',
        parentSourcePath: null,
        unsupportedReason: null,
      },
      {
        sourcePath: 'Projects/Launch.md',
        title: 'Launch',
        bodyMarkdown: '# Launch\n\nExact body.  ',
        parentSourcePath: 'Projects/',
        unsupportedReason: null,
      },
    ]);
  });

  it('uses a standards-based CSV parser and creates one candidate per row', () => {
    const candidates = candidatesFromFiles([
      {
        path: 'Goals.csv',
        bytes: Buffer.from('Name,Context\n"Grow, carefully","Line one\nLine two"'),
      },
    ]);
    expect(candidates[0]).toMatchObject({
      sourcePath: 'Goals.csv#row-1',
      title: 'Grow, carefully',
      bodyMarkdown: '## Context\n\nLine one\nLine two',
    });
  });

  it('rejects traversal paths before content is parsed', () => {
    expect(() =>
      candidatesFromFiles([{ path: '../private.md', bytes: Buffer.from('No') }])
    ).toThrow('unsafe file path');
  });

  it('reports unsupported files without interpreting their bytes', () => {
    expect(
      candidatesFromFiles([{ path: 'image.png', bytes: Buffer.from([0, 1, 2]) }])[0]
    ).toMatchObject({ unsupportedReason: 'Unsupported file type: .png.' });
  });

  it('restores a Planner AI vault hierarchy without treating its manifest as a Note', () => {
    const parentId = '11111111-1111-1111-1111-111111111111';
    const childId = '22222222-2222-2222-2222-222222222222';
    const candidates = candidatesFromVaultOrFiles([
      {
        path: 'Notes/Direction.md',
        bytes: Buffer.from('---\nplanner_ai_export: 1\n---\n\nDirection body'),
      },
      {
        path: 'Notes/Evidence.md',
        bytes: Buffer.from('---\nplanner_ai_export: 1\n---\n\nEvidence body'),
      },
      {
        path: 'planner-ai-vault.json',
        bytes: Buffer.from(
          JSON.stringify({
            format: 'planner-ai-notes-vault',
            schemaVersion: 1,
            notes: [
              {
                id: parentId,
                parentNoteId: null,
                path: 'Notes/Direction.md',
                title: 'Direction',
                sortKey: 1000,
              },
              {
                id: childId,
                parentNoteId: parentId,
                path: 'Notes/Evidence.md',
                title: 'Evidence',
                sortKey: 2000,
              },
            ],
          })
        ),
      },
    ]);
    expect(candidates).toEqual([
      {
        sourcePath: `planner-ai-vault/${parentId}`,
        parentSourcePath: null,
        title: 'Direction',
        bodyMarkdown: 'Direction body',
        unsupportedReason: null,
      },
      {
        sourcePath: `planner-ai-vault/${childId}`,
        parentSourcePath: `planner-ai-vault/${parentId}`,
        title: 'Evidence',
        bodyMarkdown: 'Evidence body',
        unsupportedReason: null,
      },
    ]);
  });
});
