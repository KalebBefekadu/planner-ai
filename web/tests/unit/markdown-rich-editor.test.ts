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
  });

  it('preserves table alignment through the rich editor document', () => {
    const markdown = '| Goal | Status | Score |\n| :--- | :---: | ---: |\n| Build | Active | 80% |';
    const document = plannerMarkdownToRichDocument(markdown);

    expect(document?.content?.[0]?.content?.[0]?.content).toMatchObject([
      { type: 'tableHeader', attrs: { align: 'left' } },
      { type: 'tableHeader', attrs: { align: 'center' } },
      { type: 'tableHeader', attrs: { align: 'right' } },
    ]);
    expect(
      plannerMarkdownIsSemanticallyEquivalent(markdown, richDocumentToPlannerMarkdown(document!)!)
    ).toBe(true);
  });

  it('refuses a rich table that cannot be represented as GFM Markdown', () => {
    expect(
      richDocumentToPlannerMarkdown({
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableHeader',
                    attrs: { colspan: 2 },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Merged' }] }],
                  },
                ],
              },
            ],
          },
        ],
      })
    ).toBeNull();
  });

  it('keeps checked state and nested detail blocks in portable task lists', () => {
    const markdown = '- [ ] Write the invitation\n  - Ask for feedback\n- [x] Send the draft';
    const document = plannerMarkdownToRichDocument(markdown);

    expect(document).toMatchObject({
      content: [
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: false } },
            { type: 'taskItem', attrs: { checked: true } },
          ],
        },
      ],
    });
    expect(
      plannerMarkdownIsSemanticallyEquivalent(markdown, richDocumentToPlannerMarkdown(document!)!)
    ).toBe(true);
  });
});
