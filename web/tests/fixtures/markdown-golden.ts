export type MarkdownGoldenDocument = {
  name: string;
  markdown: string;
};

const foundations: MarkdownGoldenDocument[] = [
  { name: 'empty', markdown: '' },
  { name: 'paragraph', markdown: 'A plain paragraph.' },
  { name: 'soft-break', markdown: 'First line\nsecond line' },
  { name: 'hard-break', markdown: 'First line  \nsecond line' },
  { name: 'thematic-break', markdown: 'Before\n\n---\n\nAfter' },
  ...Array.from({ length: 6 }, (_, index) => ({
    name: `heading-${index + 1}`,
    markdown: `${'#'.repeat(index + 1)} Heading ${index + 1}`,
  })),
  { name: 'emphasis', markdown: 'A _careful_ choice.' },
  { name: 'strong', markdown: 'A **clear** commitment.' },
  { name: 'combined-emphasis', markdown: 'A ***deeply important*** goal.' },
  { name: 'inline-code', markdown: 'Use `planner sync` here.' },
  { name: 'escaped-punctuation', markdown: '\\*literal asterisks\\*' },
  { name: 'blockquote', markdown: '> A quoted idea\n>\n> With a second paragraph.' },
  { name: 'link', markdown: '[Planner](https://example.com "Example")' },
  { name: 'image', markdown: '![A planning board](https://example.com/board.png)' },
  { name: 'reference-link', markdown: '[Planner][app]\n\n[app]: https://example.com' },
];

const taskDocuments = Array.from({ length: 20 }, (_, index) => ({
  name: `task-list-${index + 1}`,
  markdown: `- [${index % 2 === 0 ? ' ' : 'x'}] Task ${index + 1}\n  - Nested detail ${index + 1}\n- [ ] Follow-up`,
}));

const tableDocuments = Array.from({ length: 10 }, (_, index) => ({
  name: `table-${index + 1}`,
  markdown: `| Goal | Status | Score |\n| :--- | :---: | ---: |\n| Goal ${index + 1} | Active | ${index * 10}% |`,
}));

const frontmatterDocuments = Array.from({ length: 10 }, (_, index) => ({
  name: `frontmatter-${index + 1}`,
  markdown: `---\nplanner:\n  id: object-${index + 1}\n  type: page\n  schema: 1\ntags: [planning, review-${index + 1}]\n---\n\n# Page ${index + 1}`,
}));

const codeDocuments = Array.from({ length: 10 }, (_, index) => ({
  name: `code-${index + 1}`,
  markdown: `Before code ${index + 1}.\n\n\`\`\`ts\nconst goal${index + 1} = { done: false }\n\`\`\`\n\nAfter code.`,
}));

const unicodeSamples = [
  'Amharic: \u12D5\u1245\u12F5 \u12A5\u1293 \u1270\u130D\u1263\u122D',
  'Arabic: \u0627\u0644\u062A\u062E\u0637\u064A\u0637 \u0644\u0644\u062D\u064A\u0627\u0629',
  'Japanese: \u4EBA\u751F\u8A08\u753B',
  'Korean: \uC778\uC0DD \uACC4\uD68D',
  'Hindi: \u091C\u0940\u0935\u0928 \u092F\u094B\u091C\u0928\u093E',
  'Accents: cafe\u0301 and na\u00EFve',
  'Math text: \u03A3, \u03C0, and \u221E',
  'Currency: $10, \u20AC20, \u00A330, \u00A540',
  'Direction: English \u05E2\u05D1\u05E8\u05D9\u05EA English',
  'Symbols: \u2713 \u2192 \u2605',
];
const unicodeDocuments = unicodeSamples.map((markdown, index) => ({
  name: `unicode-${index + 1}`,
  markdown,
}));

const edgeDocuments: MarkdownGoldenDocument[] = [
  { name: 'strikethrough', markdown: 'Keep ~~old~~ current thinking.' },
  { name: 'autolink', markdown: 'Visit https://example.com or contact person@example.com.' },
  { name: 'footnote', markdown: 'A claim.[^source]\n\n[^source]: Supporting context.' },
  {
    name: 'nested-ordered-list',
    markdown: '1. First\n   1. Nested\n   2. Nested again\n2. Second',
  },
  { name: 'start-number', markdown: '4. Fourth\n5. Fifth' },
  { name: 'loose-list', markdown: '- First paragraph\n\n- Second paragraph' },
  { name: 'html-preserved', markdown: '<details><summary>Source</summary>Raw</details>' },
  {
    name: 'planner-extension',
    markdown: '```planner-callout\nkind: decision\ntext: Preserve me\n```',
  },
  { name: 'malformed-emphasis', markdown: 'This **never closes.' },
  { name: 'malformed-link', markdown: 'A [link without destination' },
  { name: 'deep-quote', markdown: '> Level 1\n>> Level 2\n>>> Level 3' },
  { name: 'code-with-fence', markdown: '````md\n```inside```\n````' },
  { name: 'empty-table-cell', markdown: '| A | B |\n| - | - |\n|   | value |' },
  { name: 'table-pipes', markdown: '| A | B |\n| - | - |\n| `a\\|b` | c |' },
  { name: 'nested-formatting', markdown: '> - [x] **Done** with [evidence](https://example.com)' },
  { name: 'definition-title', markdown: '[ref]: https://example.com "Evidence"\n\nUse [ref].' },
  { name: 'character-entities', markdown: 'Copyright &copy; and ampersand &amp;.' },
  { name: 'null-byte-text', markdown: 'Before \uFFFD after.' },
  { name: 'long-word', markdown: `A${'b'.repeat(500)}.` },
  { name: 'whitespace', markdown: '  Indented but not code\n\nTrailing spaces   ' },
  { name: 'mixed-list', markdown: '- Bullet\n\n  1. Ordered\n  2. Ordered\n\n- Bullet' },
  { name: 'task-with-paragraph', markdown: '- [ ] Task\n\n  Supporting paragraph.' },
  { name: 'inline-html', markdown: 'Before <kbd>Cmd</kbd> after.' },
  { name: 'url-parentheses', markdown: '[Link](https://example.com/a_(b))' },
  { name: 'unicode-heading', markdown: '# \u12D5\u1245\u12F5 \u4EBA\u751F \uC778\uC0DD' },
  { name: 'blank-quote', markdown: '>\n> Thought after blank quote.' },
  { name: 'multiple-code-spans', markdown: 'Use `` `inside` `` safely.' },
  { name: 'escaped-table-pipe', markdown: '| Value |\n| - |\n| a \\| b |' },
  { name: 'frontmatter-dashes', markdown: '---\ntitle: "A -- B"\n---\n\nBody.' },
  { name: 'final-no-newline', markdown: '# Final' },
];

export const markdownGoldenCorpus = [
  ...foundations,
  ...taskDocuments,
  ...tableDocuments,
  ...frontmatterDocuments,
  ...codeDocuments,
  ...unicodeDocuments,
  ...edgeDocuments,
] satisfies MarkdownGoldenDocument[];
