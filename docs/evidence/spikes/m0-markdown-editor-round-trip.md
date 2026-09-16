# M0 Spike: Markdown And Editor Round Trip

Status: In progress; guarded rich-editor candidate implemented
Owner: Planner AI engineering  
Started: 2026-08-25

## Decision Being Tested

Normalized CommonMark plus the selected GFM subset and reserved YAML frontmatter should be Planner AI's semantic document contract. An editor is an adapter to this contract, not the owner of user data.

## Implemented Contract

`web/src/lib/markdown/contract.ts` uses pinned unified/mdast packages to provide:

- CommonMark parsing and deterministic serialization;
- GFM tables, task lists, strikethrough, autolinks, and footnotes;
- YAML frontmatter preservation without interpreting it as executable configuration;
- position-independent semantic AST comparison;
- a generic editor adapter interface;
- visible diagnostics for preserved raw HTML;
- portable fenced `planner-*` extension blocks.

The initial adapter is an identity mdast bridge. It exists to prove the semantic contract and test harness before a rich-text editor is introduced.

## Guarded Tiptap Candidate

The authenticated Notes workspace now includes a Tiptap 3 rich mode using the official React, ProseMirror, and StarterKit packages. It is not a second persistence model: every edit is converted back to canonical Markdown before the existing autosave path runs.

`web/src/lib/markdown/rich-editor.ts` accepts only the reversible subset: paragraphs, headings, emphasis, strong, strikethrough, inline code, links without titles, hard breaks, blockquotes, thematic breaks, fenced code, tight ordered or unordered lists, GFM task lists including checked state, and GFM tables with column alignment. The full golden corpus runs through this compatibility gate. A document is offered rich mode only when its Markdown-to-Tiptap-to-Markdown result is semantically equivalent.

Frontmatter, raw HTML, footnotes, images, reference links, loose lists, merged table cells, multi-block table cells, and any other unrepresented construct remain in Source mode. The workspace makes that visible rather than attempting a lossy conversion. Desktop and mobile browser journeys verify that rich formatting and task completion write back to the same portable Markdown Note.

## Golden Corpus

`web/tests/fixtures/markdown-golden.ts` contains 44 named documents, exercised by 115 assertions, covering:

- headings, paragraphs, breaks, emphasis, links, images, and references;
- nested ordered and unordered lists;
- task states;
- code spans and fenced code;
- GFM tables, autolinks, strikethrough, and footnotes;
- YAML frontmatter;
- Unicode and bidirectional text;
- raw and inline HTML preservation;
- malformed input and whitespace edge cases;
- Planner extension fences.

`web/tests/unit/markdown-contract.test.ts` verifies semantic equivalence, normalization idempotence, and a checked-in normalized-output snapshot for every fixture.

## Pass Criteria For This Stage

- Every named fixture is deterministic.
- Parse and serialize cycles preserve the semantic AST.
- A second normalization makes no change.
- Raw HTML remains recoverable but is reported and never executed.
- Planner extension fences remain portable Markdown.
- Package versions and the lockfile are committed together.

## Real Export Corpus, 2026-09-10

`web/tests/fixtures/exported-vaults.ts` holds 27 documents shaped after what Notion's "Export as Markdown & CSV" and an Obsidian vault actually emit, including the conventions neither product calls Markdown: wikilinks, embeds, block references, callout admonitions, inline tags, highlights, and Dataview fields.

It found a shipped defect on the first run, which the synthetic corpus could not have found by construction.

`plannerMarkdownSupportsRichEditing` gated rich mode on *semantic* equivalence. Escaping is always semantically safe -- `\[\[Note]]` and `[[Note]]` carry the same text -- so the gate approved every Obsidian document, and serializing then escaped the brackets. One save in rich mode turned `[[North star & values]]` into `\[\[North star & values]]`. The meaning was preserved and every link in the vault was broken, silently. The same held for embeds, block references and `> [!warning]` callout markers.

The gate now also requires that the round trip introduce no backslash escape the source did not already have. Counting added escapes rather than comparing the text outright was deliberate: a stricter textual gate was measured first and dropped rich editing from 110 of 137 documents to 76, giving up every table to fix wikilinks. The escape-aware gate costs 9 documents, and those 9 are exactly the ones that would have been damaged.

This is the second defect in this area whose cause was invisible to an equivalence check. Semantic equality is the right test for whether meaning survived and the wrong test for whether a file changed.

## Scale, 2026-09-10

Measured on a 6,000-line Note in `web/tests/unit/markdown-scale.test.ts`: parse 375ms, normalize 414ms, rich-mode gate 957ms. Parsing is linear; doubling the input roughly doubles the time, which is asserted rather than assumed.

The gate's second is the one that matters, because it runs on the path between clicking a Note and seeing it. It is a full round trip, so it is inherently the most expensive check in the open path, and on a large document it is close to a second of nothing happening. It is not yet cached or moved off that path.

## Work Still Required Before Editor ADR Acceptance

1. Broaden the Tiptap adapter only one reversible Markdown feature at a time, with corpus and browser proof for each addition.
2. Implement or select one fallback editor adapter for comparison.
3. Add copy/paste, undo/redo, selection, source-mode, and external-file-edit scenarios.
4. Move the rich-mode gate off the document open path, or cache it per version.
5. Decide whether wikilinks and callouts should be *supported* through micromark extensions rather than merely protected by refusal. Refusal keeps vaults intact; it also means an imported Obsidian vault can never be edited richly.

Tiptap remains a candidate until its adapter passes. The semantic Markdown contract does not weaken to accommodate a library limitation.
