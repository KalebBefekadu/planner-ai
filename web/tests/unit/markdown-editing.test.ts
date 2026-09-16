import { describe, expect, it } from 'vitest';
import {
  continueMarkdownList,
  insertMarkdownTable,
  wrapMarkdownSelection,
} from '@/lib/markdown/editing';

describe('Markdown source editing', () => {
  it('wraps just the selected source range and keeps the selection inside markup', () => {
    expect(wrapMarkdownSelection('Plan calmly', 0, 4, '**')).toEqual({
      markdown: '**Plan** calmly',
      selectionStart: 2,
      selectionEnd: 6,
    });
  });

  it.each([
    ['- First', '- First\n- ', 10],
    ['  * First', '  * First\n  * ', 14],
    ['3. First', '3. First\n4. ', 12],
    ['- [x] Done', '- [x] Done\n- [ ] ', 17],
  ])('continues %s as a matching Markdown list', (source, markdown, cursor) => {
    expect(continueMarkdownList(source, source.length, source.length)).toEqual({
      markdown,
      selectionStart: cursor,
      selectionEnd: cursor,
    });
  });

  it.each(['- ', '1. ', '- [ ] '])('exits an empty list item for %s', (source) => {
    expect(continueMarkdownList(source, source.length, source.length)).toEqual({
      markdown: '',
      selectionStart: 0,
      selectionEnd: 0,
    });
  });

  it('does not replace an explicit text selection when continuing lines', () => {
    expect(continueMarkdownList('- First', 1, 3)).toBeNull();
  });
});

describe('inserting a table', () => {
  const table = '| Column | Column |\n| --- | --- |\n| Value | Value |';

  /* The next keystroke should name the first column, not land somewhere in the
     scaffolding, so the heading cell is what comes back selected. */
  it('selects the first heading cell', () => {
    const edit = insertMarkdownTable('', 0, 0);
    expect(edit.markdown).toBe(table);
    expect(edit.markdown.slice(edit.selectionStart, edit.selectionEnd)).toBe('Column');
  });

  /* A table that touches the paragraph above it is not a table to a Markdown
     parser. */
  it('separates the table from text immediately above it', () => {
    const edit = insertMarkdownTable('Notes', 5, 5);
    expect(edit.markdown).toBe(`Notes\n\n${table}`);
    expect(edit.markdown.slice(edit.selectionStart, edit.selectionEnd)).toBe('Column');
  });

  it('separates the table from text immediately below it', () => {
    const edit = insertMarkdownTable('Notes', 0, 0);
    expect(edit.markdown).toBe(`${table}\n\nNotes`);
  });

  /* Adding separators unconditionally leaves a trail of blank lines behind
     every insertion at a line that already ends in one. */
  it('adds no blank line where the text already has one', () => {
    const edit = insertMarkdownTable('Notes\n', 6, 6);
    expect(edit.markdown).toBe(`Notes\n${table}`);
  });

  // The selection spans "REPLACED " including its trailing space, so what is
  // left on either side is exactly "before " and "after".
  it('replaces the selection rather than keeping it', () => {
    const edit = insertMarkdownTable('before REPLACED after', 7, 16);
    expect(edit.markdown).toBe(`before \n\n${table}\n\nafter`);
  });
});
