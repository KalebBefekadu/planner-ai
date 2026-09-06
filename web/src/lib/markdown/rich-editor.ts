import type { JSONContent } from '@tiptap/core';
import {
  parsePlannerMarkdown,
  plannerMarkdownIsSemanticallyEquivalent,
  serializePlannerMarkdown,
  type PlannerMarkdownAst,
} from '@/lib/markdown/contract';

type MarkdownNode = {
  type?: unknown;
  value?: unknown;
  url?: unknown;
  title?: unknown;
  depth?: unknown;
  ordered?: unknown;
  start?: unknown;
  checked?: unknown;
  lang?: unknown;
  meta?: unknown;
  spread?: unknown;
  children?: unknown;
};

type RichMark = NonNullable<JSONContent['marks']>[number];

function markdownChildren(value: MarkdownNode) {
  return Array.isArray(value.children) ? (value.children as MarkdownNode[]) : [];
}

function markdownInlineToRich(value: MarkdownNode, marks: RichMark[] = []): JSONContent[] | null {
  switch (value.type) {
    case 'text':
      return typeof value.value === 'string'
        ? [{ type: 'text', text: value.value, ...(marks.length ? { marks } : {}) }]
        : null;
    case 'emphasis':
      return markdownInlineChildrenToRich(value, [...marks, { type: 'italic' }]);
    case 'strong':
      return markdownInlineChildrenToRich(value, [...marks, { type: 'bold' }]);
    case 'delete':
      return markdownInlineChildrenToRich(value, [...marks, { type: 'strike' }]);
    case 'inlineCode':
      return typeof value.value === 'string'
        ? [{ type: 'text', text: value.value, marks: [...marks, { type: 'code' }] }]
        : null;
    case 'link':
      if (typeof value.url !== 'string' || value.title !== null) return null;
      return markdownInlineChildrenToRich(value, [
        ...marks,
        { type: 'link', attrs: { href: value.url } },
      ]);
    case 'break':
      return [{ type: 'hardBreak' }];
    default:
      return null;
  }
}

function markdownInlineChildrenToRich(value: MarkdownNode, marks: RichMark[]) {
  const output: JSONContent[] = [];
  for (const child of markdownChildren(value)) {
    const converted = markdownInlineToRich(child, marks);
    if (!converted) return null;
    output.push(...converted);
  }
  return output;
}

function markdownBlockToRich(value: MarkdownNode): JSONContent | null {
  switch (value.type) {
    case 'paragraph': {
      const content = markdownInlineChildrenToRich(value, []);
      return content ? { type: 'paragraph', ...(content.length ? { content } : {}) } : null;
    }
    case 'heading': {
      if (typeof value.depth !== 'number' || value.depth < 1 || value.depth > 6) return null;
      const content = markdownInlineChildrenToRich(value, []);
      return content
        ? { type: 'heading', attrs: { level: value.depth }, ...(content.length ? { content } : {}) }
        : null;
    }
    case 'blockquote': {
      const content = markdownBlockChildrenToRich(value);
      return content ? { type: 'blockquote', content } : null;
    }
    case 'thematicBreak':
      return { type: 'horizontalRule' };
    case 'code':
      return typeof value.value === 'string'
        ? {
            type: 'codeBlock',
            ...(typeof value.lang === 'string' ? { attrs: { language: value.lang } } : {}),
            ...(value.value ? { content: [{ type: 'text', text: value.value }] } : {}),
          }
        : null;
    case 'list': {
      if (value.ordered !== true && value.ordered !== false) return null;
      if (value.spread === true) return null;
      const items = markdownChildren(value);
      const isTaskList =
        value.ordered === false &&
        items.length > 0 &&
        items.every(
          (item) => item.type === 'listItem' && (item.checked === true || item.checked === false)
        );
      const content = items.map((item) => markdownListItemToRich(item, isTaskList));
      if (!content.every((item): item is JSONContent => item !== null)) return null;
      return {
        type: isTaskList ? 'taskList' : value.ordered ? 'orderedList' : 'bulletList',
        ...(value.ordered && typeof value.start === 'number' && value.start !== 1
          ? { attrs: { start: value.start } }
          : {}),
        content,
      };
    }
    case 'listItem': {
      return markdownListItemToRich(value, false);
    }
    default:
      return null;
  }
}

function markdownListItemToRich(value: MarkdownNode, taskItem: boolean): JSONContent | null {
  if (value.type !== 'listItem' || value.spread === true) return null;
  const checked = value.checked === true || value.checked === false ? value.checked : null;
  if ((taskItem && checked === null) || (!taskItem && checked !== null)) return null;
  const content = markdownBlockChildrenToRich(value);
  return content
    ? {
        type: taskItem ? 'taskItem' : 'listItem',
        ...(taskItem ? { attrs: { checked } } : {}),
        content,
      }
    : null;
}

function markdownBlockChildrenToRich(value: MarkdownNode) {
  const output: JSONContent[] = [];
  for (const child of markdownChildren(value)) {
    const converted = markdownBlockToRich(child);
    if (!converted) return null;
    output.push(converted);
  }
  return output;
}

/** Returns null when rich editing would lose a Markdown construct. */
export function plannerMarkdownToRichDocument(markdown: string): JSONContent | null {
  const ast = parsePlannerMarkdown(markdown) as unknown as MarkdownNode;
  if (ast.type !== 'root') return null;
  const content = markdownBlockChildrenToRich(ast);
  return content ? { type: 'doc', content } : null;
}

function richMarksToMarkdown(value: JSONContent): MarkdownNode | null {
  if (typeof value.text !== 'string') return null;
  let node: MarkdownNode = { type: 'text', value: value.text };
  for (const mark of [...(value.marks ?? [])].reverse()) {
    switch (mark.type) {
      case 'italic':
        node = { type: 'emphasis', children: [node] };
        break;
      case 'bold':
        node = { type: 'strong', children: [node] };
        break;
      case 'strike':
        node = { type: 'delete', children: [node] };
        break;
      case 'code':
        if (node.type !== 'text') return null;
        node = { type: 'inlineCode', value: node.value };
        break;
      case 'link': {
        const href = mark.attrs?.href;
        if (typeof href !== 'string') return null;
        node = { type: 'link', url: href, title: null, children: [node] };
        break;
      }
      default:
        return null;
    }
  }
  return node;
}

function richChildrenToMarkdown(value: JSONContent) {
  const output: MarkdownNode[] = [];
  for (const child of value.content ?? []) {
    const converted = richNodeToMarkdown(child);
    if (!converted) return null;
    output.push(converted);
  }
  return output;
}

function richInlineChildrenToMarkdown(value: JSONContent) {
  const output: MarkdownNode[] = [];
  for (const child of value.content ?? []) {
    if (child.type === 'hardBreak') {
      output.push({ type: 'break' });
      continue;
    }
    const converted = richMarksToMarkdown(child);
    if (!converted) return null;
    output.push(converted);
  }
  return output;
}

function richNodeToMarkdown(value: JSONContent): MarkdownNode | null {
  switch (value.type) {
    case 'paragraph': {
      const children = richInlineChildrenToMarkdown(value);
      return children ? { type: 'paragraph', children } : null;
    }
    case 'heading': {
      const level = value.attrs?.level;
      const children = richInlineChildrenToMarkdown(value);
      return typeof level === 'number' && level >= 1 && level <= 6 && children
        ? { type: 'heading', depth: level, children }
        : null;
    }
    case 'blockquote': {
      const children = richChildrenToMarkdown(value);
      return children ? { type: 'blockquote', children } : null;
    }
    case 'horizontalRule':
      return { type: 'thematicBreak' };
    case 'codeBlock': {
      const children = richInlineChildrenToMarkdown(value);
      if (!children || children.some((child) => child.type !== 'text')) return null;
      const language = value.attrs?.language;
      return {
        type: 'code',
        lang: typeof language === 'string' ? language : null,
        meta: null,
        value: children.map((child) => String(child.value ?? '')).join(''),
      };
    }
    case 'bulletList':
    case 'orderedList': {
      const children = richChildrenToMarkdown(value);
      if (!children || children.some((child) => child.type !== 'listItem')) return null;
      const start = value.attrs?.start;
      return {
        type: 'list',
        ordered: value.type === 'orderedList',
        start: value.type === 'orderedList' && typeof start === 'number' ? start : null,
        spread: false,
        children,
      };
    }
    case 'taskList': {
      const children = richChildrenToMarkdown(value);
      if (!children || children.some((child) => child.type !== 'listItem')) return null;
      return {
        type: 'list',
        ordered: false,
        start: null,
        spread: false,
        children,
      };
    }
    case 'listItem': {
      const children = richChildrenToMarkdown(value);
      return children ? { type: 'listItem', spread: false, checked: null, children } : null;
    }
    case 'taskItem': {
      const children = richChildrenToMarkdown(value);
      const checked = value.attrs?.checked;
      return typeof checked === 'boolean' && children
        ? { type: 'listItem', spread: false, checked, children }
        : null;
    }
    default:
      return null;
  }
}

export function richDocumentToPlannerMarkdown(document: JSONContent): string | null {
  if (document.type !== 'doc') return null;
  const children = richChildrenToMarkdown(document);
  if (!children) return null;
  return serializePlannerMarkdown({ type: 'root', children } as PlannerMarkdownAst);
}

export function plannerMarkdownSupportsRichEditing(markdown: string) {
  const document = plannerMarkdownToRichDocument(markdown);
  if (!document) return false;
  const roundTripped = richDocumentToPlannerMarkdown(document);
  return roundTripped !== null && plannerMarkdownIsSemanticallyEquivalent(markdown, roundTripped);
}
