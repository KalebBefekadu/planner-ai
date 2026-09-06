import { describe, expect, it } from 'vitest';
import { markdownGoldenCorpus } from '../fixtures/markdown-golden';
import {
  extractPlannerMarkdownHeadings,
  inspectPlannerMarkdown,
  mdastIdentityEditorAdapter,
  normalizePlannerMarkdown,
  parsePlannerMarkdown,
  plannerMarkdownIsSemanticallyEquivalent,
  roundTripPlannerMarkdown,
} from '@/lib/markdown/contract';

describe('Planner Markdown semantic contract', () => {
  it('contains at least 100 named golden documents', () => {
    expect(markdownGoldenCorpus.length).toBeGreaterThanOrEqual(100);
    expect(new Set(markdownGoldenCorpus.map((document) => document.name)).size).toBe(
      markdownGoldenCorpus.length
    );
  });

  it.each(markdownGoldenCorpus)('round-trips $name without semantic loss', ({ markdown }) => {
    const result = roundTripPlannerMarkdown(markdown, mdastIdentityEditorAdapter);
    expect(result.semanticallyEquivalent).toBe(true);
    expect(plannerMarkdownIsSemanticallyEquivalent(markdown, result.normalizedMarkdown)).toBe(true);
    expect(normalizePlannerMarkdown(result.normalizedMarkdown)).toBe(result.normalizedMarkdown);
  });

  it('keeps the normalized corpus stable as a golden snapshot', () => {
    expect(
      Object.fromEntries(
        markdownGoldenCorpus.map(({ name, markdown }) => [name, normalizePlannerMarkdown(markdown)])
      )
    ).toMatchSnapshot();
  });

  it('preserves raw HTML but reports that it is not executable content', () => {
    const markdown = '<script>alert("never execute")</script>';
    const normalized = normalizePlannerMarkdown(markdown);
    expect(normalized).toContain('<script>alert("never execute")</script>');
    expect(inspectPlannerMarkdown(parsePlannerMarkdown(markdown))).toContainEqual({
      severity: 'notice',
      code: 'raw_html_preserved',
      message: 'Raw HTML is preserved in source mode and is not executed by Planner AI.',
    });
  });

  it('preserves Planner extension fences as ordinary, portable code blocks', () => {
    const markdown = '```planner-callout\nkind: decision\ntext: Keep this\n```';
    expect(normalizePlannerMarkdown(markdown)).toContain('```planner-callout');
    expect(
      plannerMarkdownIsSemanticallyEquivalent(markdown, normalizePlannerMarkdown(markdown))
    ).toBe(true);
  });

  it('derives a source-line-aware outline without retaining a second document model', () => {
    expect(
      extractPlannerMarkdownHeadings(
        '# Direction\n\n## _A_ [linked](https://example.com) outcome\n\n### Next step'
      )
    ).toEqual([
      { depth: 1, text: 'Direction', line: 1 },
      { depth: 2, text: 'A linked outcome', line: 3 },
      { depth: 3, text: 'Next step', line: 5 },
    ]);
  });
});
