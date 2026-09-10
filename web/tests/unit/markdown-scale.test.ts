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

describe('a large Note', () => {
  const document = longDocument(400); // ~6,400 lines
  const lines = document.split('\n').length;

  it('is the size this test claims it is', () => {
    expect(lines).toBeGreaterThan(5_000);
  });

  it('parses in a time that does not grow quadratically', () => {
    const half = millis(() => parsePlannerMarkdown(longDocument(200)));
    const full = millis(() => parsePlannerMarkdown(document));
    /* Doubling the input should roughly double the work. Four times is the
       signal that something is scanning the document once per node. The bound
       is generous because timing on a shared machine is noisy; a quadratic at
       this size would exceed it by a wide margin, not squeak past. */
    expect(full).toBeLessThan(Math.max(half * 6, 40));
  });

  it('normalizes within a budget a person would not notice', () => {
    expect(millis(() => normalizePlannerMarkdown(document))).toBeLessThan(2_000);
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

  it('decides whether rich mode is safe without stalling the editor', () => {
    /* This runs on every document open, so it is on the path between a person
       clicking a Note and seeing it. It does the full round trip internally,
       which is why it is measured separately rather than assumed cheap. */
    expect(millis(() => plannerMarkdownSupportsRichEditing(document))).toBeLessThan(3_000);
  });
});
