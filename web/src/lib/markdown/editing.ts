export type MarkdownTextEdit = {
  markdown: string;
  selectionStart: number;
  selectionEnd: number;
};

export function wrapMarkdownSelection(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
  suffix = prefix
): MarkdownTextEdit {
  return {
    markdown: `${markdown.slice(0, selectionStart)}${prefix}${markdown.slice(selectionStart, selectionEnd)}${suffix}${markdown.slice(selectionEnd)}`,
    selectionStart: selectionStart + prefix.length,
    selectionEnd: selectionEnd + prefix.length,
  };
}

/** Continue an ordinary, ordered, or task-list item, or leave an empty item. */
export function continueMarkdownList(
  markdown: string,
  selectionStart: number,
  selectionEnd: number
): MarkdownTextEdit | null {
  if (selectionStart !== selectionEnd) return null;
  const lineStart = markdown.lastIndexOf('\n', selectionStart - 1) + 1;
  const lineEnd = markdown.indexOf('\n', selectionStart);
  const currentLine = markdown.slice(lineStart, lineEnd === -1 ? markdown.length : lineEnd);
  const task = currentLine.match(/^(\s*)- \[([ xX])\] (.*)$/);
  const unordered = currentLine.match(/^(\s*)([-*+])\s+(.*)$/);
  const ordered = currentLine.match(/^(\s*)(\d+)([.)])\s+(.*)$/);

  const edit = (replacement: string, cursor: number): MarkdownTextEdit => ({
    markdown: `${markdown.slice(0, lineStart)}${replacement}${markdown.slice(lineEnd === -1 ? markdown.length : lineEnd)}`,
    selectionStart: lineStart + cursor,
    selectionEnd: lineStart + cursor,
  });

  if (task) {
    const [, indent, , content] = task;
    if (!content.trim()) return edit(indent, indent.length);
    const next = `\n${indent}- [ ] `;
    return edit(`${currentLine}${next}`, currentLine.length + next.length);
  }
  if (unordered) {
    const [, indent, marker, content] = unordered;
    if (!content.trim()) return edit(indent, indent.length);
    const next = `\n${indent}${marker} `;
    return edit(`${currentLine}${next}`, currentLine.length + next.length);
  }
  if (ordered) {
    const [, indent, number, delimiter, content] = ordered;
    if (!content.trim()) return edit(indent, indent.length);
    const next = `\n${indent}${Number(number) + 1}${delimiter} `;
    return edit(`${currentLine}${next}`, currentLine.length + next.length);
  }
  return null;
}
