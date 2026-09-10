/* Markdown as Notion and Obsidian actually emit it.
 *
 * The golden corpus is synthetic: it was written alongside the parser, by
 * someone who already knew what the parser handled. That makes it good at
 * proving determinism and bad at finding surprises. These documents are shaped
 * after the two exporters a person would actually migrate from, including the
 * constructs neither product documents and both produce.
 *
 * The point is not that Planner AI must render all of this. It is that nothing
 * here may be silently changed. A construct we do not support belongs in Source
 * mode, visibly; it does not belong quietly rewritten into something else. */

export type ExportedDocument = {
  name: string;
  /** Where a person's file would have come from. */
  origin: 'notion' | 'obsidian';
  markdown: string;
  /** What we expect the rich editor to do. Recorded so a change is deliberate.
   *  'rich'   -- fully reversible, safe to offer the rich editor
   *  'source' -- holds something the adapter cannot represent reversibly */
  editing: 'rich' | 'source';
  /** Why, when it is source-only. Keeps the expectation honest. */
  note?: string;
};

/* Notion's "Export as Markdown & CSV".
 *
 * The details that bite: the title is a level-one heading rather than
 * frontmatter, page properties are emitted as loose plain-text lines directly
 * under it, links to sibling pages are relative file paths with percent
 * encoding and the 32-character page id appended, and callouts arrive as
 * blockquotes with a leading emoji. Toggles become bare list items whose
 * children are indented under them. */
const notionDocuments: ExportedDocument[] = [
  {
    name: 'notion-page-with-properties',
    origin: 'notion',
    editing: 'rich',
    markdown: [
      '# Personal operating system',
      '',
      'Status: Living document',
      'Area: Direction',
      'Review: Every month',
      '',
      'A simple system for deciding what deserves my attention.',
    ].join('\n'),
  },
  {
    name: 'notion-internal-page-link',
    origin: 'notion',
    editing: 'rich',
    markdown:
      'See [North star & values](North%20star%20&%20values%201a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.md) for context.',
  },
  {
    name: 'notion-callout-as-quote',
    origin: 'notion',
    editing: 'rich',
    markdown: '> 💡 Build with calm urgency. Speed that costs trust is not speed.',
  },
  {
    name: 'notion-toggle-list',
    origin: 'notion',
    editing: 'rich',
    markdown: ['- Why this matters', '    - It keeps the weekly review honest.'].join('\n'),
  },
  {
    name: 'notion-inline-database-table',
    origin: 'notion',
    editing: 'rich',
    markdown: [
      '| Goal | Horizon | Status |',
      '| --- | --- | --- |',
      '| Ship the dogfood release | Quarter | In progress |',
      '| Move notes off Notion | Month | Not started |',
    ].join('\n'),
  },
  {
    name: 'notion-image-attachment',
    origin: 'notion',
    editing: 'source',
    note: 'images are not in the reversible subset',
    markdown:
      '![cover.png](Personal%20operating%20system%201a2b3c4d/cover.png)\n\nThe cover above.',
  },
  {
    name: 'notion-aside-raw-html',
    origin: 'notion',
    editing: 'source',
    note: 'raw HTML is preserved and reported, never executed or converted',
    markdown: '<aside>\n⚠️ This page is generated. Edit the source instead.\n</aside>',
  },
  {
    name: 'notion-block-equation',
    origin: 'notion',
    editing: 'rich',
    note: 'no math extension; the delimiters survive as literal paragraph text',
    markdown: '$$\nE = mc^2\n$$',
  },
  {
    name: 'notion-bookmark-and-divider',
    origin: 'notion',
    editing: 'rich',
    markdown: [
      '[https://example.com/post](https://example.com/post)',
      '',
      '---',
      '',
      'After.',
    ].join('\n'),
  },
  {
    name: 'notion-nested-numbered-list',
    origin: 'notion',
    editing: 'rich',
    markdown: ['1. Capture', '2. Clarify', '    1. Is it actionable?', '3. Organise'].join('\n'),
  },
  {
    name: 'notion-checkbox-property-rows',
    origin: 'notion',
    editing: 'rich',
    markdown: ['- [x] Draft the plan', '- [ ] Review with someone', '- [ ] Ship it'].join('\n'),
  },
  {
    name: 'notion-code-block-with-language',
    origin: 'notion',
    editing: 'rich',
    markdown: '```typescript\nconst x: number = 1;\n```',
  },
];

/* An Obsidian vault.
 *
 * Obsidian's Markdown is CommonMark plus a set of conventions that are not
 * CommonMark at all: wikilinks, embeds, callouts spelled as blockquote
 * admonitions, inline tags, block references, highlights, and Dataview's
 * `key:: value` inline fields. A parser that does not know them still has to
 * leave them exactly as written -- a person's `[[Note]]` must not come back as
 * escaped brackets, because that silently breaks every link in their vault. */
const obsidianDocuments: ExportedDocument[] = [
  {
    name: 'obsidian-frontmatter-tags-aliases',
    origin: 'obsidian',
    editing: 'source',
    note: 'frontmatter is preserved but not represented in the rich editor',
    markdown: [
      '---',
      'tags: [project, active]',
      'aliases: ["POS", "Operating system"]',
      'created: 2026-08-25',
      '---',
      '',
      'Body follows the frontmatter.',
    ].join('\n'),
  },
  {
    name: 'obsidian-wikilink',
    origin: 'obsidian',
    editing: 'source',
    note: 'a wikilink is not CommonMark; serializing would escape the brackets',
    markdown: 'Related: [[North star & values]] and [[Health reset]].',
  },
  {
    name: 'obsidian-aliased-wikilink',
    origin: 'obsidian',
    editing: 'source',
    note: 'a wikilink is not CommonMark; serializing would escape the brackets',
    markdown: 'See [[2026-08-25 journal|yesterday’s journal]].',
  },
  {
    name: 'obsidian-embed',
    origin: 'obsidian',
    editing: 'source',
    note: 'an embed would be escaped into literal text, breaking the transclusion',
    markdown: '![[Weekly reset]]',
  },
  {
    name: 'obsidian-callout',
    origin: 'obsidian',
    editing: 'source',
    note: 'the [!type] marker would be escaped, downgrading the callout to a plain quote',
    markdown: '> [!warning] Do not skip this\n> The weekly review is the whole system.',
  },
  {
    name: 'obsidian-nested-callout',
    origin: 'obsidian',
    editing: 'source',
    note: 'the [!type] markers would be escaped',
    markdown: '> [!note]\n> Outer.\n>\n> > [!tip]\n> > Inner.',
  },
  {
    name: 'obsidian-inline-tags',
    origin: 'obsidian',
    editing: 'rich',
    markdown: 'Filed under #project/active and #area/health today.',
  },
  {
    name: 'obsidian-block-reference',
    origin: 'obsidian',
    editing: 'source',
    note: 'the wikilink brackets would be escaped',
    markdown: 'A claim worth citing. ^a1b2c3\n\nElsewhere: [[Source note#^a1b2c3]]',
  },
  {
    name: 'obsidian-highlight',
    origin: 'obsidian',
    editing: 'rich',
    note: '==highlight== is not CommonMark; it must round-trip as literal text',
    markdown: 'The ==important part== is the contract, not the editor.',
  },
  {
    name: 'obsidian-dataview-inline-field',
    origin: 'obsidian',
    editing: 'rich',
    markdown: 'status:: active\nreviewed:: 2026-09-01\n\nBody.',
  },
  {
    name: 'obsidian-task-states',
    origin: 'obsidian',
    editing: 'source',
    note: 'custom task states beyond [ ] and [x] are not GFM and are not reversible',
    markdown: ['- [x] Done', '- [ ] Open', '- [/] In progress', '- [-] Cancelled'].join('\n'),
  },
  {
    name: 'obsidian-footnote',
    origin: 'obsidian',
    editing: 'source',
    note: 'footnotes are outside the reversible subset',
    markdown: 'A claim.[^1]\n\n[^1]: The support for it.',
  },
  {
    name: 'obsidian-inline-math',
    origin: 'obsidian',
    editing: 'rich',
    markdown: 'Given $a^2 + b^2 = c^2$, the rest follows.',
  },
  {
    name: 'obsidian-loose-list',
    origin: 'obsidian',
    editing: 'source',
    note: 'loose lists are not in the reversible subset',
    markdown: '- First\n\n- Second\n\n- Third',
  },
  {
    name: 'obsidian-escaped-brackets',
    origin: 'obsidian',
    editing: 'rich',
    note: 'a literal bracket a person escaped on purpose must stay escaped',
    markdown: 'Not a link: \\[\\[this\\]\\].',
  },
];

export const exportedVaultCorpus: ExportedDocument[] = [...notionDocuments, ...obsidianDocuments];
