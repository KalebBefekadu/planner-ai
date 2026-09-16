import { describe, expect, it } from 'vitest';

import { convertNotionHtmlBlocks, describeNotionHtmlOutcome } from '@/lib/notes/import-notion-html';

/* Notion writes callouts as `<aside>` and toggles as `<details>`/`<summary>`
   inside an otherwise Markdown export. Planner AI renders Markdown, not HTML,
   so those reached the reader as the literal text `<aside>` and `<summary>`
   wrapped around content that was otherwise intact -- a workspace that leans
   on callouts reads as though the migration half-failed. */

describe('Notion callouts and toggles become portable Markdown', () => {
  it('turns a callout into a quote and keeps every word of it', () => {
    const outcome = convertNotionHtmlBlocks(
      [
        'Before.',
        '',
        '<aside>',
        'Protect energy before optimizing output.',
        '</aside>',
        '',
        'After.',
      ].join('\n')
    );
    expect(outcome.markdown).toContain('> Protect energy before optimizing output.');
    expect(outcome.markdown).not.toContain('<aside>');
    expect(outcome.markdown).toContain('Before.');
    expect(outcome.markdown).toContain('After.');
    expect(outcome.calloutCount).toBe(1);
  });

  it('opens a toggle out, keeping its heading above what it hid', () => {
    const outcome = convertNotionHtmlBlocks(
      [
        '<details>',
        '<summary>What matters now</summary>',
        '',
        'Focused work and health.',
        '',
        '</details>',
      ].join('\n')
    );
    expect(outcome.markdown).toContain('**What matters now**');
    expect(outcome.markdown).toContain('Focused work and health.');
    expect(outcome.markdown).not.toContain('<details>');
    expect(outcome.markdown).not.toContain('<summary>');
    expect(outcome.toggleCount).toBe(1);
  });

  it('reaches blocks nested inside each other', () => {
    const outcome = convertNotionHtmlBlocks(
      [
        '<details>',
        '<summary>Outer</summary>',
        '',
        '<aside>',
        'Inner callout.',
        '</aside>',
        '',
        '</details>',
      ].join('\n')
    );
    expect(outcome.markdown).toContain('**Outer**');
    expect(outcome.markdown).toContain('> Inner callout.');
    expect(outcome.toggleCount).toBe(1);
    expect(outcome.calloutCount).toBe(1);
  });

  /* A body this cannot read confidently is a body it has no business
     rewriting: half-converting an unbalanced document is worse than leaving
     the tags visible, because the reader can at least see the second. */
  it('leaves an unclosed tag exactly as written', () => {
    const source = ['<aside>', 'Never closed.'].join('\n');
    const outcome = convertNotionHtmlBlocks(source);
    expect(outcome.markdown).toBe(source);
    expect(outcome.calloutCount).toBe(0);
  });

  /* Byte for byte, because trailing spaces are a hard line break in Markdown
     and blank runs are the author's spacing. Tidying either on a body this
     never touched is rewriting someone's writing for no reason -- which it
     did, and which the importer's own "preserves Markdown" test caught. */
  it('leaves a body with no Notion HTML untouched, trailing spaces included', () => {
    const source = ['# Title', '', 'A hard break.  ', 'Next line.', '', '', 'Spaced out.'].join(
      '\n'
    );
    expect(convertNotionHtmlBlocks(source).markdown).toBe(source);
  });

  it('keeps the document ending it was given', () => {
    const withNewline = ['<aside>', 'Quoted.', '</aside>', ''].join('\n');
    expect(convertNotionHtmlBlocks(withNewline).markdown.endsWith('\n')).toBe(true);
    const withoutNewline = ['<aside>', 'Quoted.', '</aside>'].join('\n');
    expect(convertNotionHtmlBlocks(withoutNewline).markdown.endsWith('\n')).toBe(false);
  });

  it('says what it changed, and says nothing when it changed nothing', () => {
    expect(describeNotionHtmlOutcome({ markdown: '', calloutCount: 0, toggleCount: 0 })).toBeNull();
    expect(describeNotionHtmlOutcome({ markdown: '', calloutCount: 2, toggleCount: 1 })).toBe(
      '2 callouts became quotes, and 1 toggle was opened out, with its heading kept.'
    );
  });
});
