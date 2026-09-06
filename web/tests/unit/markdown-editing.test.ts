import { describe, expect, it } from 'vitest';
import { continueMarkdownList, wrapMarkdownSelection } from '@/lib/markdown/editing';

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
