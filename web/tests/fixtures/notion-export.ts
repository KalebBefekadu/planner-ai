import { ImportSourceFile } from '@/lib/notes/import-bundle';

/* A Notion export, shaped the way Notion actually writes one.
 *
 * MVP-01 asks for a sanitized representative export covering nesting,
 * duplicate titles, links, CSV and files, on the grounds that a generic
 * Markdown import is not evidence that anyone's workspace can move. This is
 * that corpus. It carries no real content -- the point is the *shape*, which is
 * where imports break.
 *
 * What Notion actually does, and what each of these is here to catch:
 *
 * - Every file and folder name carries the page's 32-character id. A page and
 *   its children live in a folder named after the page, id included, so the id
 *   appears in the parent path of every descendant as well as in its own name.
 * - Page titles are a level-one heading inside the file, not frontmatter, and
 *   page properties are loose `Key: value` lines directly beneath it.
 * - Links between pages are relative file paths, percent-encoded, ending in
 *   `.md` and carrying the target's id.
 * - A database exports as a CSV named after the view, alongside a folder of one
 *   Markdown file per row.
 * - Two pages may share a title. Notion tells them apart by id; a filesystem
 *   cannot, which is where a naive importer silently merges somebody's pages.
 */

const PAGE_ID = {
  root: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
  journal: '2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
  monday: '3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f',
  research: '4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90',
  // Two different pages, both called "Notes". This is the case that matters.
  notesUnderJournal: '5e6f7a8b9c0d1e2f3a4b5c6d7e8f9012',
  notesUnderResearch: '6f7a8b9c0d1e2f3a4b5c6d7e8f901234',
  tasksDatabase: '7a8b9c0d1e2f3a4b5c6d7e8f90123456',
} as const;

function file(path: string, body: string): ImportSourceFile {
  return { path, bytes: Buffer.from(body, 'utf8') };
}

export const notionExportFiles: ImportSourceFile[] = [
  // The top-level page. Properties arrive as plain lines under the heading.
  file(
    `Personal operating system ${PAGE_ID.root}.md`,
    [
      '# Personal operating system',
      '',
      'Status: Living document',
      'Area: Direction',
      '',
      'A system for deciding what deserves attention.',
      '',
      `See [Journal](Personal%20operating%20system%20${PAGE_ID.root}/Journal%20${PAGE_ID.journal}.md).`,
    ].join('\n')
  ),

  // A child page, inside the folder named for its parent.
  file(
    `Personal operating system ${PAGE_ID.root}/Journal ${PAGE_ID.journal}.md`,
    ['# Journal', '', 'Daily entries.'].join('\n')
  ),

  // A grandchild: two levels of nesting, both folder names carrying ids.
  file(
    `Personal operating system ${PAGE_ID.root}/Journal ${PAGE_ID.journal}/Monday ${PAGE_ID.monday}.md`,
    ['# Monday', '', 'Shipped the import.'].join('\n')
  ),

  file(
    `Personal operating system ${PAGE_ID.root}/Research ${PAGE_ID.research}.md`,
    ['# Research', '', 'Open questions.'].join('\n')
  ),

  /* Two pages called "Notes" in different branches. A filesystem-shaped import
     that keys on title merges these and loses one of them, with no error and no
     way for the owner to notice until the content is gone. */
  file(
    `Personal operating system ${PAGE_ID.root}/Journal ${PAGE_ID.journal}/Notes ${PAGE_ID.notesUnderJournal}.md`,
    ['# Notes', '', 'Journal notes.'].join('\n')
  ),
  file(
    `Personal operating system ${PAGE_ID.root}/Research ${PAGE_ID.research}/Notes ${PAGE_ID.notesUnderResearch}.md`,
    ['# Notes', '', 'Research notes.'].join('\n')
  ),

  /* A database. Notion writes the view as a CSV and the rows as pages, so the
     same content arrives twice in two different shapes. */
  file(
    `Personal operating system ${PAGE_ID.root}/Tasks ${PAGE_ID.tasksDatabase}.csv`,
    [
      'Name,Status,Notes',
      'Ship the import,In progress,Needs the CSV path',
      'Write it up,Not started,',
    ].join('\n')
  ),
];

/* Filenames only, for the cases that are about naming rather than content. */
export const notionExportPaths = notionExportFiles.map((source) => source.path);

export const NOTION_PAGE_ID = PAGE_ID;
