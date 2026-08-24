import { describe, expect, it } from 'vitest';
import { validateNoteImport } from '@/lib/notes/import';

describe('validateNoteImport', () => {
  it('preserves Markdown exactly and derives a readable title', () => {
    expect(validateNoteImport('project_brief.md', '# Brief\n\nExact text.')).toEqual({
      title: 'project brief',
      bodyMarkdown: '# Brief\n\nExact text.',
    });
  });

  it('accepts plain text and Markdown file extensions case-insensitively', () => {
    expect(validateNoteImport('Research.MARKDOWN', 'Findings').title).toBe('Research');
    expect(validateNoteImport('notes.TXT', 'Notes').title).toBe('notes');
  });

  it('rejects executable and unsupported file types', () => {
    expect(() => validateNoteImport('payload.html', '<script>alert(1)</script>')).toThrow(
      'Markdown or plain-text'
    );
  });

  it('rejects control data and oversized character input', () => {
    expect(() => validateNoteImport('unsafe.md', 'before\0after')).toThrow('control data');
    expect(() => validateNoteImport('huge.md', 'x'.repeat(50_001))).toThrow('50,000');
  });
});
