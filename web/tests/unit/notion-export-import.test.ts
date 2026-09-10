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

  it('turns each database row into its own page and says what that cost', () => {
    const ship = byTitle('Ship the import')[0];
    expect(ship).toBeDefined();
    // A CSV is a snapshot of a view, not the database. Saying so before the
    // owner commits is what makes the preview a decision rather than a
    // formality.
    expect(ship.conversionNotice).toMatch(
      /formulas, relations, filters and views are not imported/
    );
    expect(ship.bodyMarkdown).toContain('In progress');
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
