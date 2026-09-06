'use client';

import { useEffect, useMemo } from 'react';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  plannerMarkdownToRichDocument,
  richDocumentToPlannerMarkdown,
} from '@/lib/markdown/rich-editor';

export function RichMarkdownEditor({
  markdown,
  onChange,
  onEditorChange,
}: {
  markdown: string;
  onChange(markdown: string): void;
  onEditorChange(editor: Editor | null): void;
}) {
  const document = useMemo(() => plannerMarkdownToRichDocument(markdown), [markdown]);
  const editor = useEditor({
    extensions: [StarterKit],
    content: document ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    immediatelyRender: false,
    onUpdate: ({ editor: updatedEditor }) => {
      const nextMarkdown = richDocumentToPlannerMarkdown(updatedEditor.getJSON());
      if (nextMarkdown !== null) onChange(nextMarkdown);
    },
  });

  useEffect(() => {
    onEditorChange(editor);
    return () => onEditorChange(null);
  }, [editor, onEditorChange]);

  useEffect(() => {
    if (!editor || !document) return;
    const currentMarkdown = richDocumentToPlannerMarkdown(editor.getJSON());
    if (currentMarkdown !== markdown) {
      editor.commands.setContent(document, { emitUpdate: false });
    }
  }, [document, editor, markdown]);

  if (!document) return null;
  if (!editor) {
    return <div className="rich-markdown-editor" aria-label="Rich note editor" />;
  }
  return <EditorContent className="rich-markdown-editor" editor={editor} />;
}
