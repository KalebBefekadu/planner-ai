import { describe, expect, it } from 'vitest';
import { markdownGoldenCorpus } from '../fixtures/markdown-golden';
import {
  plannerMarkdownSupportsRichEditing,
  plannerMarkdownToRichDocument,
  richDocumentToPlannerMarkdown,
} from '@/lib/markdown/rich-editor';
import { plannerMarkdownIsSemanticallyEquivalent } from '@/lib/markdown/contract';

describe('Planner rich Markdown adapter', () => {
  it.each(markdownGoldenCorpus)(
    'does not lose semantics for supported $name documents',
    ({ markdown }) => {
      const document = plannerMarkdownToRichDocument(markdown);
      if (!document) {
        expect(plannerMarkdownSupportsRichEditing(markdown)).toBe(false);
        return;
      }

      const roundTripped = richDocumentToPlannerMarkdown(document);
      expect(roundTripped).not.toBeNull();
      expect(plannerMarkdownIsSemanticallyEquivalent(markdown, roundTripped!)).toBe(true);
      expect(plannerMarkdownSupportsRichEditing(markdown)).toBe(true);
    }
  );

  it('rejects a construct without a reversible representation', () => {
    expect(plannerMarkdownToRichDocument('---\ntitle: Private\n---\n\n# Note')).toBeNull();
    expect(plannerMarkdownToRichDocument('| One | Two |\n| --- | --- |\n| A | B |')).toBeNull();
    expect(plannerMarkdownToRichDocument('- [ ] Buy groceries')).toBeNull();
  });
});
