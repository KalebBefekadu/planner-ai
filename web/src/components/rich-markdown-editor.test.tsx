// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RichMarkdownEditor } from '@/components/rich-markdown-editor';

afterEach(cleanup);

/* Typing here used to cost a full pass over the document three times per
   keystroke: a parse of the incoming Markdown, the serialisation that produced
   it, and a second serialisation whose only job was to compare. The editor now
   remembers what it emitted so its own echo costs nothing. The risk that
   creates is the opposite one -- ignoring a change that really did come from
   somewhere else, such as voice dictation writing into the same Note -- which
   is what these hold down. */
describe('the rich editor and the draft it shares', () => {
  it('shows the Markdown it is given', async () => {
    render(
      <RichMarkdownEditor
        markdown="# Heading\n\nFirst body."
        onChange={vi.fn()}
        onEditorChange={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByRole('textbox', { name: /rich text/i })).toBeVisible());
    await waitFor(() => expect(document.body.textContent).toContain('First body.'));
  });

  it('takes up a change that came from somewhere other than itself', async () => {
    const { rerender } = render(
      <RichMarkdownEditor markdown="Typed by hand." onChange={vi.fn()} onEditorChange={vi.fn()} />
    );
    await waitFor(() => expect(document.body.textContent).toContain('Typed by hand.'));

    // What voice dictation, or a restored draft, looks like from here.
    rerender(
      <RichMarkdownEditor
        markdown="Typed by hand. Spoken aloud."
        onChange={vi.fn()}
        onEditorChange={vi.fn()}
      />
    );
    await waitFor(() => expect(document.body.textContent).toContain('Spoken aloud.'));
  });

  it('keeps showing what it has when handed back its own text', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RichMarkdownEditor markdown="Stable line." onChange={onChange} onEditorChange={vi.fn()} />
    );
    await waitFor(() => expect(document.body.textContent).toContain('Stable line.'));
    rerender(
      <RichMarkdownEditor markdown="Stable line." onChange={onChange} onEditorChange={vi.fn()} />
    );
    await waitFor(() => expect(document.body.textContent).toContain('Stable line.'));
  });
});
