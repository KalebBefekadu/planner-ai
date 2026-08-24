import { describe, expect, it } from 'vitest';
import { candidatesFromFiles } from '@/lib/notes/import-bundle';

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
});
