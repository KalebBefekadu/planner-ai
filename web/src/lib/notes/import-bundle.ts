import path from 'node:path';
import { parse as parseCsv } from 'csv-parse/sync';
import yauzl from 'yauzl';

export {
  IMPORT_LIMITS,
  IMPORT_TOO_LARGE_MESSAGE,
  IMPORT_UPLOAD_LIMIT_LABEL,
  formatImportBytes,
} from './import-limits';
import { IMPORT_LIMITS, IMPORT_UPLOAD_LIMIT_LABEL, formatImportBytes } from './import-limits';
import { describeLinkOutcome, resolveInternalLinks } from './import-links';

export type ImportSourceFile = {
  path: string;
  bytes: Buffer;
  unsupportedReason?: string;
};

export type NoteImportCandidate = {
  sourcePath: string;
  title: string;
  bodyMarkdown: string;
  parentSourcePath: string | null;
  unsupportedReason: string | null;
  // Only an exported vault carries AI Exclusion. Files from any other source
  // are normalised to false by candidatesFromVaultOrFiles.
  aiExcluded?: boolean;
  // Only an exported vault carries sibling order. Files from any other source
  // are normalised to null by candidatesFromVaultOrFiles and fall back to the
  // dependency-safe staging order.
  sourceSortKey?: number | null;
  // How the owner had this page arranged: its icon, cover, cover position and
  // whether it was pinned. Only an exported vault carries any of this; files
  // from any other source are normalised to null, because inventing an
  // appearance for an imported Notion page would be making a choice on the
  // owner's behalf and calling it a restore.
  appearance?: RestorableAppearance | null;
  // Set when the item is imported but not as a faithful copy of the source.
  // It is stored as the item's reason so the pre-commit report can say what a
  // conversion cost, instead of showing a converted row and an intact page
  // identically. Null for anything carried over unchanged.
  conversionNotice?: string | null;
};

/**
 * A CSV export is a snapshot of a database view, not the database. Planner AI
 * has no native database, so each row becomes a Note and everything the table
 * knew about itself is left behind. Naming that here keeps the wording in one
 * place and keeps it identical in the preview and in the stored report.
 */
export type RestorableAppearance = {
  iconEmoji: string | null;
  coverKey: string | null;
  coverPosition: number;
  favoritedAt: string | null;
};

/* Read an appearance out of a manifest entry, refusing anything the database
   would refuse anyway.
 *
 * A manifest is a file the owner can edit, and a restore is exactly when a
 * hand-edited one turns up. Each field falls back to its own absence rather
 * than to the whole appearance being discarded, so one bad cover position does
 * not also cost the icon. */
const COVER_POSITION_DEFAULT = 50;

function restorableAppearance(item: VaultManifestItem): RestorableAppearance {
  const position = item.coverPosition;
  return {
    iconEmoji: typeof item.iconEmoji === 'string' && item.iconEmoji ? item.iconEmoji : null,
    coverKey: typeof item.coverKey === 'string' && item.coverKey ? item.coverKey : null,
    coverPosition:
      typeof position === 'number' && Number.isInteger(position) && position >= 0 && position <= 100
        ? position
        : COVER_POSITION_DEFAULT,
    favoritedAt: typeof item.favoritedAt === 'string' && item.favoritedAt ? item.favoritedAt : null,
  };
}

export const CSV_ROW_CONVERSION_NOTICE =
  'Converted from a CSV row. Column types, formulas, relations, filters and views are not imported.';

// notes.sort_key is numeric(24, 12), so a manifest value has twelve integer
// digits of headroom. Reordering a Note writes the midpoint between its new
// neighbours, so a real vault carries fractional keys and only a non-finite or
// out-of-range value is invalid.
const MAX_SORT_KEY = 999_999_999_999;

function isRestorableSortKey(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_SORT_KEY;
}

const textExtensions = new Set(['.md', '.markdown', '.txt', '.csv']);

// The vault manifest is not a Note, but it must still be readable from a ZIP so
// that an exported vault re-imports with its own identity and hierarchy.
const VAULT_MANIFEST_PATH = 'planner-ai-vault.json';

function safePath(value: string) {
  const normalized = value.normalize('NFC');
  if (
    !normalized ||
    normalized.includes('\\') ||
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw new Error('The import contains an unsafe file path.');
  }
  return normalized;
}

function decodeText(bytes: Buffer) {
  if (bytes.byteLength > IMPORT_LIMITS.fileBytes) {
    throw new Error('One import file exceeds the 200 KB text limit.');
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\0')) throw new Error('The import contains unsupported binary content.');
  return text.replace(/^\uFEFF/, '');
}

/**
 * Notion appends the page's own 32-character hexadecimal ID to every exported
 * file and folder name, so a page the owner called "Weekly Review" arrives as
 * "Weekly Review 5f2c...c81a". That ID is Notion's internal bookkeeping, not
 * part of the title anyone wrote, and carrying it into the workspace makes an
 * imported hierarchy read as a dump of another product's internals.
 *
 * Stripping is deliberately narrow, because a title is the owner's text and
 * damaging one is worse than leaving a suffix on:
 * - exactly 32 hexadecimal characters, no more and no fewer, so a shorter hex
 *   run (a commit prefix, say) is left alone and a longer one is not truncated
 *   to 32;
 * - preceded by a single space, which is the separator Notion uses; a title
 *   that runs the hex straight on to a word is not a Notion export name;
 * - only at the very end of the name;
 * - and never when it would leave nothing behind, so a page whose whole
 *   exported name is the ID keeps a title rather than becoming blank.
 *
 * It is applied only to titles derived from a path. A title taken from the
 * document's own `# heading` is text the owner wrote inside the page and is
 * never rewritten.
 */
const NOTION_ID_SUFFIX = / [0-9a-f]{32}$/i;

export function stripNotionIdSuffix(title: string) {
  const stripped = title.replace(NOTION_ID_SUFFIX, '').trim();
  return stripped || title;
}

function titleFrom(pathname: string, body: string) {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.slice(0, 300);
  return titleFromPath(pathname);
}

/* The name a file gets when nothing inside it offers a better one.
 *
 * Split out because the failure paths need it too. A Notion database whose CSV
 * cannot be parsed still has to appear in the report under the name the owner
 * would recognise -- "Tasks", not "Tasks 5f2c...c81a.csv". Those rows are the
 * ones a person reads most carefully, because they are the ones that did not
 * work, and showing them Notion's internal bookkeeping there is the least
 * useful moment to do it. */
function titleFromPath(pathname: string) {
  const stripped = stripNotionIdSuffix(path.posix.basename(pathname, path.posix.extname(pathname)));
  return (stripped || 'Imported Note').slice(0, 300);
}

function markdownCell(value: unknown) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function csvCandidates(sourcePath: string, body: string, parentSourcePath: string | null) {
  let records: Array<Record<string, string>>;
  try {
    records = parseCsv(body, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      max_record_size: IMPORT_LIMITS.fileBytes,
    }) as Array<Record<string, string>>;
  } catch {
    return [
      {
        sourcePath,
        title: titleFromPath(sourcePath),
        bodyMarkdown: '',
        parentSourcePath,
        unsupportedReason: 'CSV could not be parsed safely.',
      },
    ];
  }
  if (!records.length) {
    return [
      {
        sourcePath,
        title: titleFromPath(sourcePath),
        bodyMarkdown: '',
        parentSourcePath,
        unsupportedReason: 'CSV contains no data rows.',
      },
    ];
  }
  const columns = Object.keys(records[0]);
  const titleColumn =
    columns.find((column) => ['name', 'title'].includes(column.trim().toLowerCase())) ?? columns[0];
  return records.map((record, index) => {
    const title = markdownCell(record[titleColumn]) || `Row ${index + 1}`;
    const markdown = columns
      .filter((column) => column !== titleColumn && markdownCell(record[column]))
      .map((column) => `## ${column}\n\n${markdownCell(record[column])}`)
      .join('\n\n');
    return {
      sourcePath: `${sourcePath}#row-${index + 1}`,
      title: title.slice(0, 300),
      bodyMarkdown: markdown,
      parentSourcePath,
      unsupportedReason: null,
      conversionNotice: CSV_ROW_CONVERSION_NOTICE,
    };
  });
}

function addFolders(files: ImportSourceFile[], candidates: NoteImportCandidate[]) {
  const folders = new Set<string>();
  for (const file of files) {
    const parts = file.path.split('/').slice(0, -1);
    for (let index = 0; index < parts.length; index += 1) {
      folders.add(`${parts.slice(0, index + 1).join('/')}/`);
    }
  }
  for (const folder of [...folders].sort((a, b) => a.split('/').length - b.split('/').length)) {
    const withoutSlash = folder.slice(0, -1);
    const parent = withoutSlash.includes('/')
      ? `${withoutSlash.slice(0, withoutSlash.lastIndexOf('/'))}/`
      : null;
    candidates.push({
      sourcePath: folder,
      title: stripNotionIdSuffix(path.posix.basename(withoutSlash)).slice(0, 300),
      bodyMarkdown: '',
      parentSourcePath: parent,
      unsupportedReason: null,
    });
  }
}

/**
 * An exported workspace is a web of pages that link to each other by relative
 * file path. Those paths mean nothing inside Planner AI, so the links are
 * rewritten in place to name the item they point at, and the commit turns each
 * one into the created Note's URL. Resolution is by path rather than by title,
 * so two pages that share a title still link to the right one.
 *
 * Mutates the candidates: their bodies carry the rewritten links, and any item
 * whose links changed or could not be followed gains a reason saying so before
 * the owner agrees to the commit.
 */
function resolveCandidateLinks(candidates: NoteImportCandidate[]) {
  const byPath = new Map<string, { sourcePath: string; importable: boolean }>();
  for (const candidate of candidates) {
    byPath.set(candidate.sourcePath, {
      sourcePath: candidate.sourcePath,
      importable: candidate.unsupportedReason === null,
    });
    // A CSV file is not itself a Note: its rows are. A link to the file names
    // a database view that was not imported as a page, which is a different
    // answer from "this export does not contain it".
    const rowSeparator = candidate.sourcePath.lastIndexOf('#row-');
    if (rowSeparator > 0) {
      const filePath = candidate.sourcePath.slice(0, rowSeparator);
      if (!byPath.has(filePath)) byPath.set(filePath, { sourcePath: filePath, importable: false });
    }
  }
  for (const candidate of candidates) {
    if (candidate.unsupportedReason !== null || !candidate.bodyMarkdown) continue;
    const outcome = resolveInternalLinks(candidate.bodyMarkdown, candidate.sourcePath, byPath);
    candidate.bodyMarkdown = outcome.bodyMarkdown;
    const notice = describeLinkOutcome(outcome);
    if (!notice) continue;
    candidate.conversionNotice = candidate.conversionNotice
      ? `${candidate.conversionNotice} ${notice}`.slice(0, 500)
      : notice;
  }
}

export function candidatesFromFiles(files: ImportSourceFile[]) {
  const normalized = files.map((file) => ({ ...file, path: safePath(file.path) }));
  const candidates: NoteImportCandidate[] = [];
  addFolders(normalized, candidates);
  for (const file of normalized) {
    if (file.path.startsWith('__MACOSX/') || path.posix.basename(file.path).startsWith('.'))
      continue;
    const extension = path.posix.extname(file.path).toLowerCase();
    const directory = path.posix.dirname(file.path);
    const parentSourcePath = directory === '.' ? null : `${directory}/`;
    if (file.unsupportedReason || !textExtensions.has(extension)) {
      candidates.push({
        sourcePath: file.path,
        title: path.posix.basename(file.path).slice(0, 300),
        bodyMarkdown: '',
        parentSourcePath,
        unsupportedReason:
          file.unsupportedReason ?? `Unsupported file type: ${extension || 'unknown'}.`,
      });
      continue;
    }
    let body: string;
    try {
      body = decodeText(file.bytes);
    } catch (error) {
      candidates.push({
        sourcePath: file.path,
        title: path.posix.basename(file.path).slice(0, 300),
        bodyMarkdown: '',
        parentSourcePath,
        unsupportedReason: error instanceof Error ? error.message : 'Text could not be read.',
      });
      continue;
    }
    if (extension === '.csv') {
      candidates.push(...csvCandidates(file.path, body, parentSourcePath));
    } else {
      candidates.push({
        sourcePath: file.path,
        title: titleFrom(file.path, body),
        bodyMarkdown: body,
        parentSourcePath,
        unsupportedReason: null,
      });
    }
  }
  resolveCandidateLinks(candidates);
  if (candidates.length > IMPORT_LIMITS.candidates) {
    throw new Error(`An import may contain at most ${IMPORT_LIMITS.candidates} Notes.`);
  }
  const characters = candidates.reduce(
    (total, candidate) => total + candidate.title.length + candidate.bodyMarkdown.length,
    0
  );
  if (characters > IMPORT_LIMITS.totalCharacters) {
    throw new Error('The expanded import contains too much text.');
  }
  return candidates;
}

type VaultManifestItem = {
  id: string;
  parentNoteId: string | null;
  path: string;
  title: string;
  sortKey: number;
  /* Written by every vault this version exports. Older archives predate them,
     so each is optional and each has a defined absence: no icon, no cover, the
     default position, not a favourite. An old vault restores exactly as it did
     before rather than failing to open. */
  iconEmoji?: string | null;
  coverKey?: string | null;
  coverPosition?: number | null;
  favoritedAt?: string | null;
};

function vaultCandidates(files: ImportSourceFile[]) {
  const manifestFile = files.find((file) => file.path === VAULT_MANIFEST_PATH);
  if (!manifestFile) return null;
  let manifest: { format?: string; schemaVersion?: number; notes?: VaultManifestItem[] };
  try {
    manifest = JSON.parse(decodeText(manifestFile.bytes)) as typeof manifest;
  } catch {
    return null;
  }
  if (
    manifest.format !== 'planner-ai-notes-vault' ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.notes)
  )
    return null;
  const byPath = new Map(files.map((file) => [file.path, file]));
  const ids = new Set(manifest.notes.map((note) => note.id));
  if (ids.size !== manifest.notes.length)
    throw new Error('The Planner AI vault manifest contains duplicate Note IDs.');
  return manifest.notes.map((note) => {
    if (
      !/^[0-9a-f-]{36}$/i.test(note.id) ||
      (note.parentNoteId !== null && !ids.has(note.parentNoteId)) ||
      !isRestorableSortKey(note.sortKey)
    ) {
      throw new Error('The Planner AI vault manifest contains an invalid Note hierarchy.');
    }
    const file = byPath.get(note.path);
    if (!file || path.posix.extname(note.path).toLowerCase() !== '.md') {
      throw new Error('The Planner AI vault is missing a Markdown Note listed in its manifest.');
    }
    // Match only Planner AI's own export frontmatter, and tolerate archives
    // written with or without a blank line after the closing fence.
    const text = decodeText(file.bytes);
    const frontmatter = /^---\nplanner_ai_export: 1\n((?:[^\n]*\n)*?)---\n\n?/.exec(text);
    // Restoring a vault must not quietly return an excluded Note to AI retrieval.
    const aiExcluded = /^planner_ai_ai_excluded: true$/m.test(frontmatter?.[1] ?? '');
    return {
      sourcePath: `planner-ai-vault/${note.id}`,
      parentSourcePath: note.parentNoteId ? `planner-ai-vault/${note.parentNoteId}` : null,
      title: String(note.title || 'Imported Note').slice(0, 300),
      bodyMarkdown: frontmatter ? text.slice(frontmatter[0].length) : text,
      unsupportedReason: null,
      aiExcluded,
      sourceSortKey: note.sortKey,
      appearance: restorableAppearance(note),
    } satisfies NoteImportCandidate;
  });
}

export function candidatesFromVaultOrFiles(files: ImportSourceFile[]) {
  const candidates = vaultCandidates(files) ?? candidatesFromFiles(files);
  return candidates.map((candidate) => ({
    aiExcluded: false,
    sourceSortKey: null,
    conversionNotice: null,
    appearance: null,
    ...candidate,
  }));
}

function openZip(buffer: Buffer) {
  return new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error('ZIP could not be opened.'));
      else resolve(zip);
    });
  });
}

function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry) {
  return new Promise<Buffer>((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(error ?? new Error('ZIP entry could not be read.'));
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > IMPORT_LIMITS.fileBytes) stream.destroy(new Error('ZIP entry is too large.'));
        else chunks.push(chunk);
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

export async function filesFromZip(buffer: Buffer) {
  if (buffer.byteLength > IMPORT_LIMITS.archiveBytes) {
    throw new Error(`ZIP exceeds ${IMPORT_UPLOAD_LIMIT_LABEL}.`);
  }
  const zip = await openZip(buffer);
  const files: ImportSourceFile[] = [];
  let expandedBytes = 0;
  return new Promise<ImportSourceFile[]>((resolve, reject) => {
    const fail = (error: unknown) => {
      zip.close();
      reject(error);
    };
    zip.on('error', fail);
    zip.on('entry', async (entry) => {
      try {
        const entryPath = safePath(entry.fileName.replace(/\/$/, ''));
        if (/\/$/.test(entry.fileName)) {
          zip.readEntry();
          return;
        }
        expandedBytes += entry.uncompressedSize;
        if (expandedBytes > IMPORT_LIMITS.expandedBytes) {
          throw new Error(
            `ZIP expands beyond the ${formatImportBytes(IMPORT_LIMITS.expandedBytes)} safety limit.`
          );
        }
        if (files.length >= IMPORT_LIMITS.candidates) {
          throw new Error('ZIP contains too many files.');
        }
        const extension = path.posix.extname(entryPath).toLowerCase();
        const readable = textExtensions.has(extension) || entryPath === VAULT_MANIFEST_PATH;
        if (!readable || entry.uncompressedSize > IMPORT_LIMITS.fileBytes) {
          files.push({
            path: entryPath,
            bytes: Buffer.alloc(0),
            unsupportedReason:
              entry.uncompressedSize > IMPORT_LIMITS.fileBytes
                ? 'File exceeds the 200 KB text limit.'
                : undefined,
          });
        } else {
          files.push({ path: entryPath, bytes: await readEntry(zip, entry) });
        }
        zip.readEntry();
      } catch (error) {
        fail(error);
      }
    });
    zip.on('end', () => resolve(files));
    zip.readEntry();
  });
}
