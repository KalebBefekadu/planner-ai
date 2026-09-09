import { createHash } from 'node:crypto';
import path from 'node:path';
import type { NoteImportCandidate } from './import-bundle';

/**
 * A Notion export links one page to another by relative file path, not by any
 * identity Planner AI knows. Left alone those links survive the import as dead
 * text: they point at a file that only ever existed inside the archive. The
 * import knows the answer at the moment it reads the bundle -- it has every
 * source path in front of it -- but it does not yet know the Note IDs, because
 * no Note exists until the owner commits.
 *
 * So a resolved link is rewritten to this marker, and the commit replaces the
 * marker with the created Note's address once the ID exists. The scheme is
 * deliberately not a real one, so nothing renders it as a working URL if a
 * commit is interrupted before the marker is resolved.
 *
 * The marker carries the SHA-256 of the target's source path rather than the
 * path itself. Notion paths contain spaces and parentheses, which cannot be
 * written inside a Markdown destination, and a fixed-length hex digest also
 * means no source path can be a prefix of another marker.
 */
export const IMPORT_LINK_SCHEME = 'planner-ai-import://';

export function importLinkMarker(sourcePath: string) {
  return `${IMPORT_LINK_SCHEME}${createHash('sha256').update(sourcePath).digest('hex')}`;
}

// Notion appends the page's 32-character ID to every exported file and folder
// name. It is not part of the title the owner wrote, and carrying it into the
// workspace makes a restored hierarchy unreadable.
const NOTION_ID_SUFFIX = /[ _-][0-9a-f]{32}$/i;

// Inline Markdown links and images. Titles ("...") are kept as written; only
// the destination is ever rewritten.
const LINK_PATTERN = /(!?)\[([^\]\n]*)\]\(\s*([^)\s]+)([^)]*)\)/g;

const ABSOLUTE_TARGET = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i;

export type StructureSourceType = 'notion' | 'obsidian' | 'generic';

type LinkTally = {
  resolved: number;
  missing: number;
  unsupported: number;
  databaseView: number;
  attachments: number;
};

function decodeTarget(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    // A half-encoded href is still a real link in the export; matching it
    // literally is better than discarding it.
    return value;
  }
}

/**
 * Resolve an export-relative href against the linking file. Duplicate titles
 * are irrelevant here on purpose: identity comes from the path, so two pages
 * called "Notes" resolve to two different files rather than to whichever one
 * was indexed last.
 */
function resolveTarget(sourcePath: string, href: string) {
  const withoutFragment = href.split('#')[0].split('?')[0];
  if (!withoutFragment) return null;
  const decoded = decodeTarget(withoutFragment).normalize('NFC');
  const directory = path.posix.dirname(sourcePath);
  const joined = path.posix.normalize(
    directory === '.' ? decoded : path.posix.join(directory, decoded)
  );
  if (joined.startsWith('..')) return null;
  return joined;
}

function tidyNotionTitle(title: string) {
  const stripped = title.replace(NOTION_ID_SUFFIX, '').trim();
  return stripped || title;
}

function describe(tally: LinkTally) {
  const parts: string[] = [];
  if (tally.resolved) {
    parts.push(
      `${tally.resolved} internal ${tally.resolved === 1 ? 'link now opens' : 'links now open'} the imported Note.`
    );
  }
  if (tally.databaseView) {
    parts.push(
      `${tally.databaseView} ${tally.databaseView === 1 ? 'link points' : 'links point'} at a database view; its rows were imported as separate Notes, so the link is left as written.`
    );
  }
  if (tally.missing) {
    parts.push(
      `${tally.missing} ${tally.missing === 1 ? 'link has' : 'links have'} no target in this import and stays as written.`
    );
  }
  if (tally.unsupported) {
    parts.push(
      `${tally.unsupported} ${tally.unsupported === 1 ? 'link points' : 'links point'} at a file this import cannot read.`
    );
  }
  if (tally.attachments) {
    parts.push(
      `${tally.attachments} image or file ${tally.attachments === 1 ? 'reference is' : 'references are'} not imported; Planner AI imports text only.`
    );
  }
  return parts.join(' ');
}

/**
 * Rewrite resolvable internal links and say, per item, what happened to the
 * structure around it. Nothing is dropped: an unresolved link keeps its
 * original text, and the reason it could not be resolved is reported before
 * the owner commits rather than discovered afterwards.
 */
export function resolveImportStructure(
  candidates: NoteImportCandidate[],
  options: { sourceType: StructureSourceType }
): NoteImportCandidate[] {
  const supported = new Set<string>();
  const known = new Set<string>();
  // A CSV becomes one Note per row, so the CSV path itself is never a Note.
  // Recording it separately is what lets a link to a database view be
  // explained instead of reported as a missing file.
  const databaseViews = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.sourcePath.includes('#row-')) {
      databaseViews.add(candidate.sourcePath.split('#row-')[0]);
      continue;
    }
    known.add(candidate.sourcePath);
    if (!candidate.unsupportedReason) supported.add(candidate.sourcePath);
  }
  for (const view of databaseViews) known.add(view);

  return candidates.map((candidate) => {
    const title =
      options.sourceType === 'notion' ? tidyNotionTitle(candidate.title) : candidate.title;
    if (!candidate.bodyMarkdown || candidate.unsupportedReason) {
      return { ...candidate, title };
    }
    const tally: LinkTally = {
      resolved: 0,
      missing: 0,
      unsupported: 0,
      databaseView: 0,
      attachments: 0,
    };
    const bodyMarkdown = candidate.bodyMarkdown.replace(
      LINK_PATTERN,
      (match, bang: string, text: string, href: string, trailing: string) => {
        if (ABSOLUTE_TARGET.test(href)) return match;
        const resolved = resolveTarget(candidate.sourcePath, href);
        if (!resolved) return match;
        // A link may name the folder page rather than a file; a folder is a
        // Note here too, and it is stored with its trailing separator.
        const target = known.has(resolved) ? resolved : `${resolved}/`;
        if (bang === '!' || !known.has(target)) {
          if (bang === '!') tally.attachments += 1;
          else tally.missing += 1;
          return match;
        }
        if (databaseViews.has(target)) {
          tally.databaseView += 1;
          return match;
        }
        if (!supported.has(target)) {
          tally.unsupported += 1;
          return match;
        }
        tally.resolved += 1;
        return `[${text}](${importLinkMarker(target)}${trailing})`;
      }
    );
    const notice = describe(tally);
    if (!notice) return { ...candidate, title };
    return {
      ...candidate,
      title,
      bodyMarkdown,
      conversionNotice: [candidate.conversionNotice, notice].filter(Boolean).join(' '),
    };
  });
}
