import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { candidatesFromVaultOrFiles } from '@/lib/notes/import-bundle';
import { importLinkMarker, resolveImportStructure } from '@/lib/notes/import-structure';

function file(path: string, contents: string) {
  return { path, bytes: Buffer.from(contents) };
}

function notion(files: Array<{ path: string; bytes: Buffer }>) {
  return candidatesFromVaultOrFiles(files, { sourceType: 'notion' });
}

function byPath(candidates: ReturnType<typeof notion>, sourcePath: string) {
  const found = candidates.find((candidate) => candidate.sourcePath === sourcePath);
  if (!found) throw new Error(`No candidate for ${sourcePath}`);
  return found;
}

// A real Notion export names every file and folder "Title <32 hex>" and links
// pages to each other by percent-encoded relative path.
const WORKSPACE = 'Workspace 0f8a1b2c3d4e5f60718293a4b5c6d7e8';
const PROJECTS = `${WORKSPACE}/Projects 1a2b3c4d5e6f708192a3b4c5d6e7f809`;
const LAUNCH = `${PROJECTS}/Launch 2b3c4d5e6f708192a3b4c5d6e7f8091a.md`;
const RETRO = `${PROJECTS}/Launch 3c4d5e6f708192a3b4c5d6e7f8091a2b.md`;

describe('Notion structure and conversion reporting', () => {
  it('keeps the page hierarchy and drops the Notion ID from titles', () => {
    const candidates = notion([file(LAUNCH, '# Launch\n\nBody')]);
    expect(candidates.map((candidate) => [candidate.title, candidate.parentSourcePath])).toEqual([
      ['Workspace', null],
      ['Projects', `${WORKSPACE}/`],
      ['Launch', `${PROJECTS}/`],
    ]);
  });

  // Notion titles are not unique, so a link can only be resolved by path. Two
  // pages called "Launch" in the same folder must resolve to different Notes.
  it('resolves an encoded internal link to the right page when titles collide', () => {
    const candidates = notion([
      file(
        LAUNCH,
        `# Launch\n\nSee [the retro](${encodeURIComponent('Launch 3c4d5e6f708192a3b4c5d6e7f8091a2b.md')}).`
      ),
      file(RETRO, '# Launch\n\nRetro body'),
    ]);
    const launch = byPath(candidates, LAUNCH);
    expect(launch.bodyMarkdown).toBe(`# Launch\n\nSee [the retro](${importLinkMarker(RETRO)}).`);
    expect(launch.conversionNotice).toContain('1 internal link now opens the imported Note.');
  });

  // The marker is what the commit resolves into a Note address, so its shape
  // is a contract with execute_note_import_operation.
  it('stages a resolved link as the digest of the target source path', () => {
    expect(importLinkMarker(RETRO)).toBe(
      `planner-ai-import://${createHash('sha256').update(RETRO).digest('hex')}`
    );
  });

  it('resolves a link that names a nested page folder', () => {
    const candidates = notion([
      file(LAUNCH, '# Launch\n\n[Up a level](..)'),
      file(`${PROJECTS}/Notes 4d5e6f708192a3b4c5d6e7f8091a2b3c.md`, '# Notes\n\nBody'),
    ]);
    expect(byPath(candidates, LAUNCH).bodyMarkdown).toContain(importLinkMarker(`${WORKSPACE}/`));
  });

  it('reports a link whose target is not in the import instead of rewriting it', () => {
    const candidates = notion([file(LAUNCH, '# Launch\n\n[Gone](Missing%20Page.md)')]);
    const launch = byPath(candidates, LAUNCH);
    expect(launch.bodyMarkdown).toBe('# Launch\n\n[Gone](Missing%20Page.md)');
    expect(launch.conversionNotice).toContain('no target in this import');
  });

  it('reports attachments and unreadable targets without discarding the reference', () => {
    const candidates = notion([
      file(LAUNCH, '# Launch\n\n![Chart](chart.png)\n\n[Deck](deck.pdf)'),
      { path: `${PROJECTS}/chart.png`, bytes: Buffer.from([0, 1, 2]) },
      { path: `${PROJECTS}/deck.pdf`, bytes: Buffer.from([0, 1, 2]) },
    ]);
    const launch = byPath(candidates, LAUNCH);
    expect(launch.bodyMarkdown).toContain('![Chart](chart.png)');
    expect(launch.conversionNotice).toContain('image or file reference is not imported');
    expect(launch.conversionNotice).toContain('cannot read');
  });

  it('explains a link to a database view whose rows became separate Notes', () => {
    const candidates = notion([
      file(LAUNCH, '# Launch\n\n[Tasks](Tasks%20aa1122.csv)'),
      file(`${PROJECTS}/Tasks aa1122.csv`, 'Name,Status\nShip,Doing'),
    ]);
    const launch = byPath(candidates, LAUNCH);
    expect(launch.conversionNotice).toContain('database view');
    const row = byPath(candidates, `${PROJECTS}/Tasks aa1122.csv#row-1`);
    expect(row.conversionNotice).toContain('formulas');
  });

  it('leaves external links and anchors alone', () => {
    const body = '# Launch\n\n[Site](https://example.com) [Top](#launch) [Mail](mailto:a@b.c)';
    const candidates = notion([file(LAUNCH, body)]);
    const launch = byPath(candidates, LAUNCH);
    expect(launch.bodyMarkdown).toBe(body);
    expect(launch.conversionNotice).toBeNull();
  });

  // Every source item must have a disposition and the counts must reconcile
  // with what the report shows.
  it('gives every source item a candidate, including unsupported files', () => {
    const candidates = notion([
      file(LAUNCH, '# Launch\n\nBody'),
      file(RETRO, '# Launch\n\nRetro'),
      { path: `${PROJECTS}/chart.png`, bytes: Buffer.from([0]) },
    ]);
    expect(candidates).toHaveLength(5);
    expect(candidates.filter((candidate) => candidate.unsupportedReason)).toHaveLength(1);
    expect(new Set(candidates.map((candidate) => candidate.sourcePath)).size).toBe(
      candidates.length
    );
  });

  // A Planner AI vault is this application's own export and is already exact.
  it('does not rewrite a Planner AI vault', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const candidates = candidatesFromVaultOrFiles(
      [
        file('Notes/Direction 00112233445566778899aabbccddeeff.md', 'Body [x](other.md)'),
        file(
          'planner-ai-vault.json',
          JSON.stringify({
            format: 'planner-ai-notes-vault',
            schemaVersion: 1,
            notes: [
              {
                id,
                parentNoteId: null,
                path: 'Notes/Direction 00112233445566778899aabbccddeeff.md',
                title: 'Direction 00112233445566778899aabbccddeeff',
                sortKey: 1000,
              },
            ],
          })
        ),
      ],
      { sourceType: 'notion' }
    );
    expect(candidates[0].title).toBe('Direction 00112233445566778899aabbccddeeff');
    expect(candidates[0].bodyMarkdown).toBe('Body [x](other.md)');
  });

  it('leaves titles untouched for a non-Notion source', () => {
    const [candidate] = resolveImportStructure(
      [
        {
          sourcePath: 'Launch 00112233445566778899aabbccddeeff.md',
          title: 'Launch 00112233445566778899aabbccddeeff',
          bodyMarkdown: '',
          parentSourcePath: null,
          unsupportedReason: null,
        },
      ],
      { sourceType: 'obsidian' }
    );
    expect(candidate.title).toBe('Launch 00112233445566778899aabbccddeeff');
  });
});
