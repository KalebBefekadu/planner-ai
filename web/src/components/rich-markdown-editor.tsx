'use client';

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { ListKit } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
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
  /* Typing here used to cost a full pass over the document three times per
     keystroke: this parse of the incoming Markdown, the serialisation in
     `onUpdate` that produced it, and a second serialisation below whose only
     job was to compare. At 6,000 lines that is 350ms a character, and the
     parse and the comparison were both spent recognising text this editor had
     just written itself.

     What it emitted is remembered instead. The parent sending that same text
     back is this editor's own echo and needs no work at all, which leaves one
     serialisation per keystroke -- 51ms at the same size. Anything else really
     did change elsewhere, and only then is it parsed and pushed in. */
  const [initialDocument] = useState(() => plannerMarkdownToRichDocument(markdown));
  // Seeded with the text the editor is constructed from, so the first render
  // does not push that same content straight back through a parse.
  const emitted = useRef<string | null>(markdown);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
      }),
      ListKit,
      TableKit.configure({ table: { resizable: false } }),
    ],
    content: initialDocument ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': 'Note body, rich text',
        'aria-multiline': 'true',
        role: 'textbox',
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      const nextMarkdown = richDocumentToPlannerMarkdown(updatedEditor.getJSON());
      if (nextMarkdown === null) return;
      emitted.current = nextMarkdown;
      onChange(nextMarkdown);
    },
  });

  useEffect(() => {
    onEditorChange(editor);
    return () => onEditorChange(null);
  }, [editor, onEditorChange]);

  useEffect(() => {
    if (!editor) return;
    // The text this editor just produced, handed back. Reparsing it would
    // rebuild the document underneath the person typing into it.
    if (markdown === emitted.current) return;
    const changedElsewhere = plannerMarkdownToRichDocument(markdown);
    if (!changedElsewhere) return;
    emitted.current = markdown;
    editor.commands.setContent(changedElsewhere, { emitUpdate: false });
  }, [editor, markdown]);

  if (!initialDocument) return null;
  if (!editor) {
    return <div className="rich-markdown-editor" aria-label="Rich note editor" />;
  }
  return <EditorContent className="rich-markdown-editor" editor={editor} />;
}
