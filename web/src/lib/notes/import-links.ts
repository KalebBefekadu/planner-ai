import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * A Notion or Obsidian export is a web of pages that link to each other by
 * relative file path. Imported as written, every one of those links points at
 * a file that does not exist inside Planner AI, so the structure the owner
 * spent years building arrives as dead text.
 *
 * The target Note does not exist yet at staging time, so the href cannot be
 * rewritten to its URL here. Instead a link that resolves to another item in
 * the same import is rewritten to an opaque token naming the target's source
 * path, and the commit turns each token into the created Note's URL. The token
 * is the SHA-256 of the NFC-normalised source path: it survives a Markdown
 * link unescaped (no spaces, parentheses or reserved characters), and the
 * database can recompute it from `note_import_items.source_path` without
 * needing a second table to carry the mapping.
 */
export const IMPORT_LINK_SCHEME = 'planner-ai-import';

/** The token the commit resolves back to a source path. */
export function importLinkToken(sourcePath: string) {
  return createHash('sha256').update(sourcePath.normalize('NFC'), 'utf8').digest('hex');
}

export type ImportLinkOutcome = {
  bodyMarkdown: string;
  /** Links rewritten to open the imported Note. */
  resolvedCount: number;
  /** Links that look internal but name nothing this export contains. */
  missingCount: number;
  /** Links whose target is in the export but is not imported as a Note. */
  unsupportedTargetCount: number;
  /** Resolved links that named a block anchor Planner AI has no equivalent for. */
  droppedFragmentCount: number;
};

// Inline links and images: [text](target), ![alt](target "title"), [text](<target>).
// Exported hrefs are percent-encoded, so an unbracketed target never contains a
// space and stopping at whitespace or ')' is safe.
const INLINE_LINK =
  /(!?\[(?:[^\]\\]|\\.)*\])\(\s*(<[^<>\n]*>|[^\s()]*)((?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*)\)/g;

// Reference definitions: [label]: target "title"
const REFERENCE_LINK = /^([ ]{0,3}\[(?:[^\]\\]|\\.)+\]:[ \t]*)(<[^<>\n]*>|\S+)/;

// Anything with a scheme (https:, mailto:, notion:) already names something
// outside this export, and '/' is already an in-application path.
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function stripAngles(target: string) {
  return target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target;
}

/**
 * Turns one exported href into the source path it names, or null when the href
 * is not a relative reference to another file in the export.
 */
function targetSourcePath(href: string, fromSourcePath: string) {
  const raw = stripAngles(href).trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('/') || HAS_SCHEME.test(raw)) return null;
  const fragmentAt = raw.search(/[#?]/);
  const withoutFragment = fragmentAt === -1 ? raw : raw.slice(0, fragmentAt);
  const fragment = fragmentAt === -1 ? '' : raw.slice(fragmentAt);
  if (!withoutFragment) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    // A malformed escape is not a link this import can follow. Leaving it
    // exactly as written is the only honest outcome.
    return null;
  }
  const directory = path.posix.dirname(fromSourcePath);
  const resolved = path.posix
    .normalize(directory === '.' ? decoded : `${directory}/${decoded}`)
    .normalize('NFC');
  // A traversal out of the export root names nothing that was imported.
  if (resolved.startsWith('..') || resolved.startsWith('/')) return null;
  return { path: resolved.replace(/\/$/, ''), fragment };
}

/**
 * Rewrites the internal links in one item's Markdown and reports what each one
 * became. `byPath` maps a candidate source path to whether that candidate is
 * imported as a Note; a folder is keyed both with and without its trailing
 * slash because an exported link to a sub-page names the directory.
 */
export function resolveInternalLinks(
  bodyMarkdown: string,
  sourcePath: string,
  byPath: Map<string, { sourcePath: string; importable: boolean }>
): ImportLinkOutcome {
  let resolvedCount = 0;
  let missingCount = 0;
  let unsupportedTargetCount = 0;
  let droppedFragmentCount = 0;

  const rewriteHref = (href: string) => {
    const target = targetSourcePath(href, sourcePath);
    if (!target) return null;
    const match = byPath.get(target.path) ?? byPath.get(`${target.path}/`);
    if (!match) {
      missingCount += 1;
      return null;
    }
    if (!match.importable) {
      unsupportedTargetCount += 1;
      return null;
    }
    // A link to the page it is written on is not structure worth rewriting.
    if (match.sourcePath === sourcePath) return null;
    resolvedCount += 1;
    // Planner AI has no addressable block inside a Note, so an anchor cannot
    // be carried across. The link still opens the right Note, and the count is
    // reported rather than the anchor being dropped in silence.
    if (target.fragment.startsWith('#')) droppedFragmentCount += 1;
    return `${IMPORT_LINK_SCHEME}:${importLinkToken(match.sourcePath)}`;
  };

  const rewriteLine = (line: string) => {
    const reference = REFERENCE_LINK.exec(line);
    if (reference) {
      const replacement = rewriteHref(reference[2]);
      return replacement ? `${reference[1]}${replacement}${line.slice(reference[0].length)}` : line;
    }
    // Inline code spans are content, not links; rewriting inside one would
    // change text the owner wrote about a link rather than a link.
    return line
      .split(/(`+[^`]*`+)/)
      .map((segment, index) =>
        index % 2 === 1
          ? segment
          : segment.replace(INLINE_LINK, (whole, label: string, href: string, trailing: string) => {
              const replacement = rewriteHref(href);
              return replacement ? `${label}(${replacement}${trailing})` : whole;
            })
      )
      .join('');
  };

  let inFence = false;
  let fence = '';
  const lines = bodyMarkdown.split('\n').map((line) => {
    const fenceMatch = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fence = fenceMatch[1][0];
      } else if (fenceMatch[1][0] === fence) {
        inFence = false;
      }
      return line;
    }
    return inFence ? line : rewriteLine(line);
  });

  return {
    bodyMarkdown: lines.join('\n'),
    resolvedCount,
    missingCount,
    unsupportedTargetCount,
    droppedFragmentCount,
  };
}

/**
 * The sentence added to an item's pre-commit reason when its links changed or
 * could not be followed. It is capped well under the 500-character reason
 * column, and it never claims a link was carried over when it was not.
 */
export function describeLinkOutcome(outcome: ImportLinkOutcome) {
  const parts: string[] = [];
  if (outcome.resolvedCount) {
    parts.push(
      `${outcome.resolvedCount} internal ${outcome.resolvedCount === 1 ? 'link' : 'links'} rewritten to open the imported Note.`
    );
  }
  if (outcome.droppedFragmentCount) {
    parts.push(
      `${outcome.droppedFragmentCount} of them pointed at a block anchor, which Planner AI cannot address; the link opens the Note instead.`
    );
  }
  if (outcome.missingCount) {
    parts.push(
      `${outcome.missingCount} ${outcome.missingCount === 1 ? 'link names a file' : 'links name files'} this export does not contain, and ${outcome.missingCount === 1 ? 'was' : 'were'} left as written.`
    );
  }
  if (outcome.unsupportedTargetCount) {
    parts.push(
      `${outcome.unsupportedTargetCount} ${outcome.unsupportedTargetCount === 1 ? 'link points' : 'links point'} at a file that is not imported as a Note, and ${outcome.unsupportedTargetCount === 1 ? 'was' : 'were'} left as written.`
    );
  }
  return parts.length ? parts.join(' ').slice(0, 500) : null;
}
