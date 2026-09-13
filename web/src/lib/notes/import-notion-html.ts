/**
 * Notion writes two of its most-used blocks as raw HTML inside an otherwise
 * Markdown export: a callout becomes `<aside>`, and a toggle becomes
 * `<details>` with a `<summary>` for its heading.
 *
 * Planner AI renders Markdown, not HTML, so those arrived in the reader's page
 * as the literal text `<aside>` and `<summary>`, wrapped around content that
 * was otherwise intact. Nothing was lost, but a workspace that leans on
 * callouts -- and most do -- reads as though the migration half-failed.
 *
 * Both are converted to portable Markdown at import, before anything is
 * written, so the stored body stays source-authoritative and there is no HTML
 * left for the renderer to refuse. A callout becomes a blockquote, which is the
 * nearest thing Markdown has and what every other tool uses for one. A toggle
 * has no Markdown equivalent at all, so its summary becomes a bold line above
 * its content: the writing survives and the grouping is visible, which is more
 * than a collapsed section nobody can expand would offer.
 *
 * Only lines that are exactly the tag are touched, and an unclosed tag is left
 * exactly as written -- a body this cannot read confidently is a body it has no
 * business rewriting.
 */

export type NotionHtmlOutcome = {
  markdown: string;
  calloutCount: number;
  toggleCount: number;
};

const OPEN_CALLOUT = '<aside>';
const CLOSE_CALLOUT = '</aside>';
const OPEN_TOGGLE = '<details>';
const CLOSE_TOGGLE = '</details>';
const SUMMARY = /^<summary>(.*)<\/summary>$/;

/** The index of the line closing the block opened at `start`, or -1. */
function closingLine(lines: string[], start: number, open: string, close: string) {
  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === open) depth += 1;
    else if (line === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function withoutSurroundingBlanks(lines: string[]) {
  let first = 0;
  let last = lines.length;
  while (first < last && lines[first].trim() === '') first += 1;
  while (last > first && lines[last - 1].trim() === '') last -= 1;
  return lines.slice(first, last);
}

function pushBlock(output: string[], block: string[]) {
  if (output.length && output[output.length - 1].trim() !== '') output.push('');
  output.push(...block, '');
}

export function convertNotionHtmlBlocks(markdown: string): NotionHtmlOutcome {
  const lines = markdown.split('\n');
  const output: string[] = [];
  let calloutCount = 0;
  let toggleCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();

    if (trimmed === OPEN_CALLOUT) {
      const end = closingLine(lines, index, OPEN_CALLOUT, CLOSE_CALLOUT);
      if (end === -1) {
        output.push(lines[index]);
        continue;
      }
      const inner = convertNotionHtmlBlocks(
        withoutSurroundingBlanks(lines.slice(index + 1, end)).join('\n')
      );
      calloutCount += 1 + inner.calloutCount;
      toggleCount += inner.toggleCount;
      pushBlock(
        output,
        inner.markdown.split('\n').map((line) => (line.trim() === '' ? '>' : `> ${line}`))
      );
      index = end;
      continue;
    }

    if (trimmed === OPEN_TOGGLE) {
      const end = closingLine(lines, index, OPEN_TOGGLE, CLOSE_TOGGLE);
      if (end === -1) {
        output.push(lines[index]);
        continue;
      }
      const body = lines.slice(index + 1, end);
      const summaryAt = body.findIndex((line) => SUMMARY.test(line.trim()));
      const summary = summaryAt === -1 ? null : (SUMMARY.exec(body[summaryAt].trim())?.[1] ?? null);
      const rest =
        summaryAt === -1 ? body : [...body.slice(0, summaryAt), ...body.slice(summaryAt + 1)];
      const inner = convertNotionHtmlBlocks(withoutSurroundingBlanks(rest).join('\n'));
      toggleCount += 1 + inner.toggleCount;
      calloutCount += inner.calloutCount;
      const block: string[] = [];
      // An empty summary is Notion's own doing and reads better as no heading
      // than as an empty bold line.
      if (summary && summary.trim()) block.push(`**${summary.trim()}**`, '');
      if (inner.markdown.trim()) block.push(...inner.markdown.split('\n'));
      pushBlock(output, withoutSurroundingBlanks(block));
      index = end;
      continue;
    }

    output.push(lines[index]);
  }

  // A document with none of these blocks in it is returned byte for byte.
  // Trailing spaces are a hard line break in Markdown, and blank runs are the
  // author's spacing: tidying either on a body this never touched would be
  // rewriting someone's writing for no reason.
  if (!calloutCount && !toggleCount) return { markdown, calloutCount, toggleCount };

  // Collapse only the blank runs the blocks above introduced, and restore the
  // document's own ending rather than trimming back into its last line.
  let markdownOut = output.join('\n').replace(/\n{3,}/g, '\n\n');
  markdownOut = markdownOut.replace(/\n+$/, markdown.endsWith('\n') ? '\n' : '');

  return { markdown: markdownOut, calloutCount, toggleCount };
}

export function describeNotionHtmlOutcome(outcome: NotionHtmlOutcome) {
  const parts: string[] = [];
  if (outcome.calloutCount) {
    parts.push(
      `${outcome.calloutCount} ${outcome.calloutCount === 1 ? 'callout' : 'callouts'} became ${outcome.calloutCount === 1 ? 'a quote' : 'quotes'}`
    );
  }
  if (outcome.toggleCount) {
    parts.push(
      `${outcome.toggleCount} ${outcome.toggleCount === 1 ? 'toggle was' : 'toggles were'} opened out, with ${outcome.toggleCount === 1 ? 'its' : 'their'} heading kept`
    );
  }
  if (!parts.length) return null;
  return `${parts.join(', and ')}.`;
}
