import { describe, expect, it } from 'vitest';

import {
  normalizePlannerMarkdown,
  plannerMarkdownIsSemanticallyEquivalent,
} from '@/lib/markdown/contract';
import { plannerMarkdownSupportsRichEditing } from '@/lib/markdown/rich-editor';
import { exportedVaultCorpus } from '../fixtures/exported-vaults';

/* The migration test.
 *
 * The golden corpus proves the parser is deterministic against documents
 * written to exercise it. This one asks a different and harder question: what
 * happens to a person's actual vault. Every document here is shaped after real
 * Notion and Obsidian output, including the conventions neither product calls
 * Markdown -- wikilinks, callouts, embeds, block references, inline fields.
 *
 * Two promises are under test, and they are not the same promise.
 *
 * The first is that nothing is silently changed. This is absolute. An
 * unsupported construct may be refused, shown as source, or reported -- it may
 * not be quietly rewritten, because the person will not find out until the link
 * they relied on has stopped resolving.
 *
 * The second is which documents may be edited richly. That is a judgement, and
 * it is recorded per fixture so that widening it stays a decision somebody
 * made rather than something that drifted. */

describe('markdown exported from Notion and Obsidian', () => {
  for (const doc of exportedVaultCorpus) {
    describe(`${doc.origin}: ${doc.name}`, () => {
      it('survives a parse and serialize without semantic change', () => {
        const normalized = normalizePlannerMarkdown(doc.markdown);
        expect(plannerMarkdownIsSemanticallyEquivalent(doc.markdown, normalized)).toBe(true);
      });

      it('normalizes only once', () => {
        const once = normalizePlannerMarkdown(doc.markdown);
        expect(normalizePlannerMarkdown(once)).toBe(once);
      });

      it(`is offered ${doc.editing} editing${doc.note ? ` -- ${doc.note}` : ''}`, () => {
        expect(plannerMarkdownSupportsRichEditing(doc.markdown)).toBe(doc.editing === 'rich');
      });
    });
  }
});

/* The constructs that are not Markdown at all.
 *
 * A wikilink is bracket text as far as CommonMark is concerned, so serializing
 * escapes it: `[[Note]]` becomes `\[\[Note]]`, and every link in an imported
 * vault breaks at once on the first save. Escaping is semantically equivalent,
 * which is why the semantic gate approved exactly the documents it would
 * damage. It is not equivalent to the person, whose vault has stopped working.
 *
 * The protection is refusal, not preservation. These stay in Source mode, where
 * the bytes are what they typed. Asserted through the round trip rather than
 * through the gate alone, so a change to either half fails here. */
describe('vault syntax that is not CommonMark is never edited richly', () => {
  const vaultSyntax: Array<[string, string]> = [
    ['wikilink', 'Related: [[North star & values]].'],
    ['aliased wikilink', 'See [[2026-08-25 journal|yesterday]].'],
    ['embed', '![[Weekly reset]]'],
    ['block reference', 'Elsewhere: [[Source note#^a1b2c3]]'],
    ['callout marker', '> [!warning] Heads up\n> Body.'],
  ];

  for (const [label, snippet] of vaultSyntax) {
    it(`keeps a ${label} in Source mode rather than escaping it`, () => {
      expect(plannerMarkdownSupportsRichEditing(snippet)).toBe(false);
    });
  }

  it('still offers rich editing to a table, which only ever gains padding', () => {
    // The counter-case that stops the fix from being "refuse everything".
    // Tables reformat on save and lose nothing, and giving them up to protect
    // wikilinks would trade one real feature for another.
    expect(plannerMarkdownSupportsRichEditing('| a | b |\n| - | - |\n| 1 | 2 |')).toBe(true);
  });

  it('leaves an escape the person wrote themselves alone', () => {
    // Someone who typed \[\[this\]\] meant literal brackets. The gate counts
    // added escapes, so a document that already has them is not penalised.
    expect(plannerMarkdownSupportsRichEditing('Not a link: \\[\\[this\\]\\].')).toBe(true);
  });
});
