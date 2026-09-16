import { describe, expect, it } from 'vitest';

import { candidatesFromVaultOrFiles } from '@/lib/notes/import-bundle';
import { notionExportFiles, NOTION_PAGE_ID } from '../fixtures/notion-export';

/* Whether a Notion workspace can actually move.
 *
 * MVP-01 is explicit that a generic Markdown import is not evidence of workflow
 * equivalence. The other import tests use documents written to exercise the
 * importer; this one uses an export shaped the way Notion writes them, and asks
 * the questions an owner would ask on the far side of a migration: are my pages
 * still where I filed them, are they called what I called them, and did two
 * different pages quietly become one. */

const candidates = () => candidatesFromVaultOrFiles(notionExportFiles);

function byTitle(title: string) {
  return candidates().filter((candidate) => candidate.title === title);
}

describe('a Notion export arrives with its shape intact', () => {
  it('names pages the way their owner named them, not the way Notion filed them', () => {
    const titles = candidates().map((candidate) => candidate.title);
    expect(titles).toContain('Personal operating system');
    expect(titles).toContain('Journal');
    expect(titles).toContain('Monday');
    // No 32-character id survives into any title.
    expect(titles.filter((title) => /[0-9a-f]{32}/i.test(title))).toEqual([]);
  });

  it('keeps two levels of nesting rather than flattening to the root', () => {
    const monday = byTitle('Monday')[0];
    expect(monday).toBeDefined();
    expect(monday.parentSourcePath).toBeTruthy();

    const all = candidates();
    const parent = all.find((candidate) => candidate.sourcePath === monday.parentSourcePath);
    expect(parent?.title).toBe('Journal');

    const grandparent = all.find((candidate) => candidate.sourcePath === parent?.parentSourcePath);
    expect(grandparent?.title).toBe('Personal operating system');
  });

  it('keeps two pages that share a title as two pages', () => {
    /* Notion tells these apart by id; a filesystem cannot. An importer that
       keys on title merges them and loses one, with no error and nothing for
       the owner to notice until the content is simply gone. */
    const notes = byTitle('Notes');
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((note) => note.sourcePath)).size).toBe(2);
    expect(new Set(notes.map((note) => note.parentSourcePath)).size).toBe(2);
    expect(notes.map((note) => note.bodyMarkdown).sort()).toEqual([
      expect.stringContaining('Journal notes'),
      expect.stringContaining('Research notes'),
    ]);
  });

  it('turns a database row with no page of its own into a page, and says what that cost', () => {
    const writeItUp = byTitle('Write it up')[0];
    expect(writeItUp).toBeDefined();
    // A CSV is a snapshot of a view, not the database. Saying so before the
    // owner commits is what makes the preview a decision rather than a
    // formality.
    expect(writeItUp.conversionNotice).toMatch(
      /formulas, relations, filters and views are not imported/
    );
    expect(writeItUp.bodyMarkdown).toContain('Not started');
  });

  /* Notion exports a database twice over: `Tasks <id>.csv`, one row per page,
     and `Tasks <id>/`, the row pages themselves. Importing both gave every row
     that someone had actually written in two Notes -- the page, and a stub
     rebuilt from the row's columns carrying the same title and none of the
     writing. */
  it('keeps the page a database row was written on, not a stub of its columns', () => {
    const ship = byTitle('Ship the import');
    expect(ship).toHaveLength(1);
    expect(ship[0].bodyMarkdown).toContain('The CSV path is the one that breaks.');
    expect(ship[0].sourcePath).not.toContain('#row-');
    expect(ship[0].conversionNotice).toBeNull();
  });

  it('files a row that has no page of its own inside the database, not beside it', () => {
    const writeItUp = byTitle('Write it up')[0];
    const tasks = candidates().find(
      (candidate) => candidate.title === 'Tasks' && candidate.sourcePath.endsWith('/')
    );
    expect(tasks).toBeDefined();
    expect(writeItUp.parentSourcePath).toBe(tasks?.sourcePath);
  });

  /* Notion writes a page that has children as two entries with the same name:
     the page, `Journal <id>.md`, and a folder, `Journal <id>/`, holding its
     children. They are one page. Importing them as two produced a duplicate of
     every page in the workspace that has anything filed under it -- one copy
     holding the text with no children, and an empty copy beside it holding all
     of them. On a real workspace that is most of the tree. */
  it('imports a page that has children once, not as a page and an empty twin', () => {
    const journals = byTitle('Journal');
    expect(journals).toHaveLength(1);
    expect(journals[0].bodyMarkdown).toContain('Daily entries.');

    const roots = byTitle('Personal operating system');
    expect(roots).toHaveLength(1);
    expect(roots[0].bodyMarkdown).toContain('A system for deciding what deserves attention.');
  });

  it('files children under the page itself rather than under its empty twin', () => {
    const all = candidates();
    const journal = all.find((candidate) => candidate.title === 'Journal');
    const monday = all.find((candidate) => candidate.title === 'Monday');
    expect(monday?.parentSourcePath).toBe(journal?.sourcePath);
    expect(journal?.sourcePath.endsWith('.md')).toBe(true);
  });

  /* A folder with no page of the same name beside it is a real container --
     that is what dragging in a folder of Markdown looks like -- and has to keep
     becoming a Note of its own. */
  it('still imports a plain folder of Markdown as a folder', () => {
    const plain = candidatesFromVaultOrFiles([
      { path: 'Recipes/Bread.md', bytes: Buffer.from('# Bread\n\nFlour.', 'utf8') },
      { path: 'Recipes/Soup.md', bytes: Buffer.from('# Soup\n\nStock.', 'utf8') },
    ]);
    const recipes = plain.find((candidate) => candidate.title === 'Recipes');
    expect(recipes).toBeDefined();
    expect(recipes?.sourcePath).toBe('Recipes/');
    expect(plain.find((c) => c.title === 'Bread')?.parentSourcePath).toBe('Recipes/');
  });

  /* Notion writes callouts as `<aside>` and toggles as `<details>`. Planner AI
     renders Markdown, not HTML, so both reached the reader as literal tags
     wrapped around content that was otherwise intact. */
  it('leaves no raw Notion HTML for the renderer to show as text', () => {
    const research = byTitle('Research')[0];
    expect(research.bodyMarkdown).not.toMatch(/<aside>|<details>|<summary>/);
    expect(research.bodyMarkdown).toContain('> Protect energy before optimizing output.');
    expect(research.bodyMarkdown).toContain('**What matters now**');
    expect(research.bodyMarkdown).toContain('Focused work, faith, health and meaning.');
    expect(research.conversionNotice).toMatch(/callout/);
  });

  it('gives an imported page no Planner AI appearance', () => {
    // Only a vault carries appearance. Inventing one for a Notion page would be
    // deciding on the owner's behalf and calling it a migration.
    expect(candidates().every((candidate) => candidate.appearance === null)).toBe(true);
  });

  it('carries an internal page link through as something resolvable', () => {
    const root = byTitle('Personal operating system')[0];
    // The link is rewritten to an import token that the commit resolves into a
    // real Note address once both pages exist. What must not happen is the raw
    // Notion path surviving into the workspace as a dead relative file link.
    expect(root.bodyMarkdown).not.toContain(`${NOTION_PAGE_ID.journal}.md`);
  });
});
