import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const notesWorkspace = readFileSync('src/components/notes-workspace.tsx', 'utf8');
const richEditorLib = readFileSync('src/lib/markdown/rich-editor.ts', 'utf8');

describe('client bundle boundaries', () => {
  // TipTap and ProseMirror are the largest client dependency in the product,
  // and Notes never opens in the mode that needs them: the editor mode starts
  // at 'source' and is reset to 'source' whenever the active Note changes. A
  // static import put the whole editor in front of every visitor to Notes.
  it('fetches the rich editor only when someone asks for rich editing', () => {
    expect(notesWorkspace).toContain("import dynamic from 'next/dynamic'");
    expect(notesWorkspace).toMatch(
      /dynamic\(\s*\(\)\s*=>\s*import\('@\/components\/rich-markdown-editor'\)/
    );
    expect(notesWorkspace).not.toMatch(
      /^import \{[^}]*RichMarkdownEditor[^}]*\} from '@\/components\/rich-markdown-editor';$/m
    );
  });

  // The Markdown contract module is imported eagerly to decide whether a Note
  // can be edited richly at all, so it must not drag the editor in with it.
  it('keeps the eagerly imported Markdown contract free of a runtime editor import', () => {
    expect(richEditorLib).not.toMatch(/^import (?!type )[^\n]*@tiptap/m);
  });

  // A control that is present, enabled, and does nothing is worse than one
  // that reports itself unavailable. Between choosing Rich and the chunk
  // arriving there is no editor to format.
  it('reports the formatting controls as unavailable until the editor arrives', () => {
    expect(notesWorkspace).toMatch(
      /const formattingUnavailable =[\s\S]{0,160}activeEditorMode === 'rich' && !richEditor/
    );
    expect(notesWorkspace).not.toContain("disabled={activeEditorMode === 'preview'}");
  });
});
