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

`web/src/lib/markdown/rich-editor.ts` accepts only the reversible subset: paragraphs, headings, emphasis, strong, strikethrough, inline code, links without titles, hard breaks, blockquotes, thematic breaks, fenced code, and tight ordered or unordered lists. The full golden corpus runs through this compatibility gate. A document is offered rich mode only when its Markdown-to-Tiptap-to-Markdown result is semantically equivalent.

Frontmatter, raw HTML, tables, task lists, footnotes, images, reference links, loose lists, and any other unrepresented construct remain in Source mode. The workspace makes that visible rather than attempting a lossy conversion. Desktop and mobile browser journeys verify that rich formatting writes back to the same portable Markdown Note.

## Golden Corpus

`web/tests/fixtures/markdown-golden.ts` contains more than 100 named documents covering:

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

- At least 100 named fixtures are deterministic.
- Parse and serialize cycles preserve the semantic AST.
- A second normalization makes no change.
- Raw HTML remains recoverable but is reported and never executed.
- Planner extension fences remain portable Markdown.
- Package versions and the lockfile are committed together.

## Work Still Required Before Editor ADR Acceptance

1. Broaden the Tiptap adapter only one reversible Markdown feature at a time, with corpus and browser proof for each addition.
2. Implement or select one fallback editor adapter for comparison.
3. Add copy/paste, undo/redo, selection, source-mode, and external-file-edit scenarios.
4. Test large documents and representative low-end hardware.
5. Run the corpus through Notion and Obsidian import/export samples.

Tiptap remains a candidate until its adapter passes. The semantic Markdown contract does not weaken to accommodate a library limitation.
