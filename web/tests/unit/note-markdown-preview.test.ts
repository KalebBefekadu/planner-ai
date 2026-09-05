import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { NoteMarkdownPreview } from '@/components/notes-workspace';

describe('NoteMarkdownPreview', () => {
  it('renders the supported GFM table and task-list syntax', () => {
    const html = renderToStaticMarkup(
      createElement(NoteMarkdownPreview, {
        markdown:
          '| Goal | Status |\n| --- | --- |\n| Ship | Active |\n\n- [x] Defined\n- [ ] Built',
      })
    );

    expect(html).toContain('<table>');
    expect(html).toContain('Goal');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
  });

  it('keeps external links safe in preview mode', () => {
    const html = renderToStaticMarkup(
      createElement(NoteMarkdownPreview, { markdown: '[Planner](https://planner.example)' })
    );

    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain('target="_blank"');
  });
});
