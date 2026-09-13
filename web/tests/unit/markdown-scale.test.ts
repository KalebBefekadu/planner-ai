import { describe, expect, it } from 'vitest';

import { normalizePlannerMarkdown, parsePlannerMarkdown } from '@/lib/markdown/contract';
import {
  plannerMarkdownSupportsRichEditing,
  plannerMarkdownToRichDocument,
  richDocumentToPlannerMarkdown,
} from '@/lib/markdown/rich-editor';

/* How the document contract behaves on a Note somebody has actually kept.
 *
 * Every other test here runs on documents of a few lines. The failure mode that
 * matters is the opposite one: a long-running journal, a book of meeting notes,
 * a research file someone has appended to for a year. Those are the documents a
 * person would least like to lose and most notice a stall in, and nothing
 * measured them.
 *
 * The budgets below are deliberately loose. They are not a performance target;
 * they are a tripwire for an accidental quadratic, which is the realistic way
 * this degrades. A machine under load may be several times slower than the one
 * that recorded these numbers and should still pass. */

function longDocument(sections: number) {
  const parts: string[] = [];
  for (let i = 0; i < sections; i += 1) {
    parts.push(
      `## Section ${i}`,
      '',
      `Some prose for section ${i}, with **strong** and _emphasis_ and \`code\`.`,
      '',
      `- first point ${i}`,
      `- second point ${i}`,
      '',
      '| Column | Value |',
      '| --- | --- |',
      `| rows | ${i} |`,
      '',
      '```ts',
      `const section = ${i};`,
      '```',
      ''
    );
  }
  return parts.join('\n');
}

function millis(work: () => unknown) {
  const started = performance.now();
  work();
  return performance.now() - started;
}

/* Timing on a shared machine is noise in one direction only: contention makes
   a run slower, never faster. The fastest of a few runs is therefore the
   closest thing to the work itself, and it is what keeps these from failing
   because seventy other test files happened to be running alongside them. */
function fastestMillis(work: () => unknown, runs = 2) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run += 1) fastest = Math.min(fastest, millis(work));
  return fastest;
}

/* Doubling the input should roughly double the work. Something scanning the
   document once per node turns that into four times, and a real quadratic at
   this size overshoots by far more than the headroom here. Stating the bound
   as a ratio rather than a number of milliseconds is what makes it a tripwire
   for the algorithm instead of a measurement of the machine -- these budgets
   were absolute, and a loaded laptop failed them while the code was fine. */
function expectNoQuadratic(half: number, full: number) {
  expect(full).toBeLessThan(Math.max(half * 6, 40));
}

describe('a large Note', () => {
  const document = longDocument(400); // ~6,400 lines
  const lines = document.split('\n').length;

  it('is the size this test claims it is', () => {
    expect(lines).toBeGreaterThan(5_000);
  });

  const halfDocument = longDocument(200);

  it('parses in a time that does not grow quadratically', { timeout: 60_000 }, () => {
    expectNoQuadratic(
      fastestMillis(() => parsePlannerMarkdown(halfDocument)),
      fastestMillis(() => parsePlannerMarkdown(document))
    );
  });

  it('normalizes in a time that does not grow quadratically', { timeout: 60_000 }, () => {
    expectNoQuadratic(
      fastestMillis(() => normalizePlannerMarkdown(halfDocument)),
      fastestMillis(() => normalizePlannerMarkdown(document))
    );
  });

  it('converts to the rich document and back without losing content', () => {
    const rich = plannerMarkdownToRichDocument(document);
    expect(rich).not.toBeNull();
    const back = richDocumentToPlannerMarkdown(rich!);
    expect(back).not.toBeNull();
    // The cheap structural check that catches truncation, which is the way a
    // conversion of this size actually fails.
    expect(back!.split('\n').length).toBeGreaterThan(lines * 0.8);
    expect(back).toContain('Section 399');
  });

  it('decides whether rich mode is safe without stalling the editor', { timeout: 60_000 }, () => {
    /* This runs on every document open, so it is on the path between a person
       clicking a Note and seeing it. It does the full round trip internally,
       which is why it is measured separately rather than assumed cheap. */
    expectNoQuadratic(
      fastestMillis(() => plannerMarkdownSupportsRichEditing(halfDocument)),
      fastestMillis(() => plannerMarkdownSupportsRichEditing(document))
    );
  });
});
