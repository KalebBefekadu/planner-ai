import { describe, expect, it } from 'vitest';
import {
  candidatesFromFiles,
  candidatesFromVaultOrFiles,
  CSV_ROW_CONVERSION_NOTICE,
  stripNotionIdSuffix,
} from '@/lib/notes/import-bundle';
import { IMPORT_LINK_SCHEME, importLinkToken } from '@/lib/notes/import-links';

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

  // A converted row and a carried-over Markdown page arrive looking identical
  // in the report. Without a stated reason the owner agrees to a commit
  // believing a Notion database came across whole, when its columns, formulas,
  // relations and views did not.
  it('says on every CSV row that the database around it was not imported', () => {
    const candidates = candidatesFromFiles([
      { path: 'Goals.csv', bytes: Buffer.from('Name,Status\nShip,Doing\nRest,Done') },
    ]);
    expect(candidates.map((candidate) => candidate.conversionNotice)).toEqual([
      CSV_ROW_CONVERSION_NOTICE,
      CSV_ROW_CONVERSION_NOTICE,
    ]);
    expect(CSV_ROW_CONVERSION_NOTICE).toContain('formulas');
  });

  // Content that is carried over unchanged must not carry a lossiness notice,
  // or the notice stops meaning anything.
  it('leaves faithfully imported Markdown without a conversion notice', () => {
    const candidates = candidatesFromVaultOrFiles([
      { path: 'Launch.md', bytes: Buffer.from('# Launch\n\nBody') },
    ]);
    expect(candidates.every((candidate) => candidate.conversionNotice === null)).toBe(true);
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
        aiExcluded: false,
        sourceSortKey: 1000,
        conversionNotice: null,
      },
      {
        sourcePath: `planner-ai-vault/${childId}`,
        parentSourcePath: `planner-ai-vault/${parentId}`,
        title: 'Evidence',
        bodyMarkdown: 'Evidence body',
        unsupportedReason: null,
        aiExcluded: false,
        sourceSortKey: 2000,
        conversionNotice: null,
      },
    ]);
  });
});

// A Notion export is a web of pages that reference each other by relative
// file path. Imported as written those hrefs name files that do not exist in
// Planner AI, so the structure the owner built arrives as dead text. The
// target Note has no id at staging time, so the link is rewritten to a token
// naming the target item and the commit turns it into the Note's URL.
describe('Notes import internal links', () => {
  it('rewrites a relative link to the item it names', () => {
    const candidates = candidatesFromFiles([
      { path: 'Roadmap.md', bytes: Buffer.from('# Roadmap\n\nSee [Launch](Projects/Launch.md).') },
      { path: 'Projects/Launch.md', bytes: Buffer.from('# Launch') },
    ]);
    const roadmap = candidates.find((candidate) => candidate.sourcePath === 'Roadmap.md')!;
    expect(roadmap.bodyMarkdown).toBe(
      `# Roadmap\n\nSee [Launch](${IMPORT_LINK_SCHEME}:${importLinkToken('Projects/Launch.md')}).`
    );
    expect(roadmap.conversionNotice).toContain('1 internal link rewritten');
  });

  // Notion percent-encodes spaces and non-ASCII characters in exported hrefs,
  // and writes the page's own id into the file name. A link that is not
  // decoded before it is matched resolves to nothing at all.
  it('follows percent-encoded and non-ASCII link targets', () => {
    const target = 'Équipe/Réunion hebdo 1a2b3c.md';
    const candidates = candidatesFromFiles([
      {
        path: 'Index.md',
        bytes: Buffer.from('# Index\n\n[Réunion](%C3%89quipe/R%C3%A9union%20hebdo%201a2b3c.md)'),
      },
      { path: target, bytes: Buffer.from('# Réunion') },
    ]);
    const index = candidates.find((candidate) => candidate.sourcePath === 'Index.md')!;
    expect(index.bodyMarkdown).toContain(`${IMPORT_LINK_SCHEME}:${importLinkToken(target)}`);
  });

  // Two Notion pages routinely share a title. Resolving a link by title would
  // pick one of them arbitrarily; resolving by path is the only way the link
  // opens the page that was actually referenced.
  it('resolves to the referenced page when two pages share a title', () => {
    const body = '# Notes\n\n[Meeting](Team%20A/Meeting.md) and [Meeting](Team%20B/Meeting.md)';
    const candidates = candidatesFromFiles([
      { path: 'Notes.md', bytes: Buffer.from(body) },
      { path: 'Team A/Meeting.md', bytes: Buffer.from('# Meeting') },
      { path: 'Team B/Meeting.md', bytes: Buffer.from('# Meeting') },
    ]);
    const notes = candidates.find((candidate) => candidate.sourcePath === 'Notes.md')!;
    expect(notes.bodyMarkdown).toContain(
      `[Meeting](${IMPORT_LINK_SCHEME}:${importLinkToken('Team A/Meeting.md')})`
    );
    expect(notes.bodyMarkdown).toContain(
      `[Meeting](${IMPORT_LINK_SCHEME}:${importLinkToken('Team B/Meeting.md')})`
    );
    expect(importLinkToken('Team A/Meeting.md')).not.toBe(importLinkToken('Team B/Meeting.md'));
  });

  // A link the import cannot follow must stay exactly as the owner wrote it,
  // and the report has to say it will not resolve. Silently deleting the href
  // would hide the one thing they need to know before agreeing to a commit.
  it('leaves an unfollowable link untouched and says so before commit', () => {
    const candidates = candidatesFromFiles([
      {
        path: 'Index.md',
        bytes: Buffer.from(
          '# Index\n\n[Gone](Archive/Gone.md) [Sheet](Data.csv) [Web](https://example.com/a.md)'
        ),
      },
      { path: 'Data.csv', bytes: Buffer.from('Name\nRow one') },
    ]);
    const index = candidates.find((candidate) => candidate.sourcePath === 'Index.md')!;
    expect(index.bodyMarkdown).toContain('[Gone](Archive/Gone.md)');
    expect(index.bodyMarkdown).toContain('[Web](https://example.com/a.md)');
    expect(index.conversionNotice).toContain('does not contain');
    expect(index.conversionNotice).toContain('not imported as a Note');
  });

  // A fenced code block that shows a Markdown link is documentation about a
  // link, not a link. Rewriting inside it would change what the page says.
  it('does not rewrite links inside fenced code', () => {
    const body = '# Doc\n\n```\n[Launch](Projects/Launch.md)\n```\n';
    const candidates = candidatesFromFiles([
      { path: 'Doc.md', bytes: Buffer.from(body) },
      { path: 'Projects/Launch.md', bytes: Buffer.from('# Launch') },
    ]);
    const doc = candidates.find((candidate) => candidate.sourcePath === 'Doc.md')!;
    expect(doc.bodyMarkdown).toBe(body);
    // candidatesFromFiles leaves the field unset; only the normalising entry
    // point fills it in, and either way nothing was reported as converted.
    expect(doc.conversionNotice ?? null).toBeNull();
  });

  // A Planner AI vault already stores links as application URLs against Note
  // ids that the restore preserves. Rewriting them would break a restore.
  it('leaves an exported Planner AI vault body untouched', () => {
    const manifest = {
      format: 'planner-ai-notes-vault',
      schemaVersion: 1,
      notes: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          parentNoteId: null,
          path: 'notes/one.md',
          title: 'One',
          sortKey: 1000,
        },
      ],
    };
    const body = '# One\n\n[Two](/notes?note=22222222-2222-4222-8222-222222222222)';
    const candidates = candidatesFromVaultOrFiles([
      { path: 'planner-ai-vault.json', bytes: Buffer.from(JSON.stringify(manifest)) },
      { path: 'notes/one.md', bytes: Buffer.from(body) },
    ]);
    expect(candidates[0].bodyMarkdown).toBe(body);
    expect(candidates[0].conversionNotice).toBeNull();
  });
});

describe('Notion ID suffix in imported titles', () => {
  const id = '5f2c8ab74e0d41d9b8e2a1c7d3406c81';

  it('strips the exported ID from a page title', () => {
    expect(stripNotionIdSuffix(`Weekly Review ${id}`)).toBe('Weekly Review');
  });

  it('leaves a shorter hexadecimal run alone', () => {
    expect(stripNotionIdSuffix('Deploy 4e0d41d9b8e2')).toBe('Deploy 4e0d41d9b8e2');
  });

  it('does not truncate a longer hexadecimal run to thirty-two characters', () => {
    expect(stripNotionIdSuffix(`Digest ab${id}`)).toBe(`Digest ab${id}`);
  });

  it('leaves a non-hexadecimal run of the same length alone', () => {
    expect(stripNotionIdSuffix(`Notes ${'z'.repeat(32)}`)).toBe(`Notes ${'z'.repeat(32)}`);
  });

  it('requires the separating space, so a run joined to a word is kept', () => {
    expect(stripNotionIdSuffix(`Review-${id}`)).toBe(`Review-${id}`);
  });

  it('only strips at the end of the title', () => {
    expect(stripNotionIdSuffix(`Review ${id} draft`)).toBe(`Review ${id} draft`);
  });

  it('keeps the title when stripping would leave nothing behind', () => {
    expect(stripNotionIdSuffix(` ${id}`)).toBe(` ${id}`);
  });

  it('keeps a title that is only the ID, because there is no separator', () => {
    expect(stripNotionIdSuffix(id)).toBe(id);
  });

  it('accepts uppercase hexadecimal', () => {
    expect(stripNotionIdSuffix(`Vision ${id.toUpperCase()}`)).toBe('Vision');
  });

  it('drops the ID from imported file and folder titles', () => {
    const candidates = candidatesFromFiles([
      {
        path: `Projects ${id}/Weekly Review ${id}.md`,
        bytes: Buffer.from('Body without heading.'),
      },
    ]);
    expect(candidates.map((candidate) => candidate.title)).toEqual(['Projects', 'Weekly Review']);
    // The source path is the export's own, and stays exact so links still resolve.
    expect(candidates[1].sourcePath).toBe(`Projects ${id}/Weekly Review ${id}.md`);
  });

  it('never rewrites a title the owner wrote as a heading', () => {
    const candidates = candidatesFromFiles([
      { path: `Page ${id}.md`, bytes: Buffer.from(`# Commit ${id}\n\nBody.`) },
    ]);
    expect(candidates[0].title).toBe(`Commit ${id}`);
  });
});

/* A Notion database that could not be read.
 *
 * These are the rows a person reads most carefully, because they are the ones
 * that did not work. Naming them with Notion's internal ID, and with the file
 * extension still attached, is the least useful moment to show either. */
describe('a CSV that cannot be imported', () => {
  const notionCsv = 'Tasks 5f2c1a3b4d5e6f708192a3b4c5d6e7f8.csv';

  it('is still named the way the owner would recognise it', () => {
    const [candidate] = candidatesFromFiles([
      { path: notionCsv, bytes: Buffer.from('"unterminated', 'utf8') },
    ]);
    expect(candidate.title).toBe('Tasks');
    expect(candidate.unsupportedReason).toBeTruthy();
  });

  it('is named the same way when it parses but holds no rows', () => {
    const [candidate] = candidatesFromFiles([
      { path: notionCsv, bytes: Buffer.from('Name,Status\n', 'utf8') },
    ]);
    expect(candidate.title).toBe('Tasks');
    expect(candidate.unsupportedReason).toBe('CSV contains no data rows.');
  });
});
