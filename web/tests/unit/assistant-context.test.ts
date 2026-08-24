import { describe, expect, it } from 'vitest';
import {
  assistantContextScopes,
  assistantSelectionForRoute,
  boundedSelectedNoteContext,
} from '@/lib/assistant/context';

const noteId = '10000000-0000-4000-8000-000000000001';

describe('assistant context routing', () => {
  it('keeps unrelated Workspace collections out of focused routes', () => {
    const notes = assistantContextScopes('/notes?note=ignored');
    expect([...notes]).toEqual(['notes', 'goals', 'actions', 'memories']);
    expect(notes.has('notifications')).toBe(false);
    expect(notes.has('conversations')).toBe(false);

    const notifications = assistantContextScopes('/notifications');
    expect([...notifications]).toEqual(['notifications', 'memories']);
    expect(notifications.has('notes')).toBe(false);
  });

  it('uses a conservative default for unknown and settings routes', () => {
    expect([...assistantContextScopes('/settings/security')]).toEqual(['memories']);
    expect([...assistantContextScopes('/future-surface')]).toEqual(['memories']);
  });

  it('accepts explicit Note selection only on the Notes route', () => {
    const selection = { type: 'note' as const, id: noteId };
    expect(assistantSelectionForRoute('/notes', selection)).toEqual(selection);
    expect(assistantSelectionForRoute('/goals', selection)).toBeUndefined();
  });

  it('bounds an explicitly selected Note body before model use', () => {
    expect(
      boundedSelectedNoteContext(
        { id: noteId, title: 'Long Note', version: 3, body_markdown: 'x'.repeat(20) },
        8
      )
    ).toEqual({
      id: noteId,
      title: 'Long Note',
      version: 3,
      bodyMarkdownExcerpt: 'xxxxxxxx',
      bodyTruncated: true,
    });
  });
});
