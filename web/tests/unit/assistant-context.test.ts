import { describe, expect, it } from 'vitest';
import {
  MAX_SELECTED_NOTE_CONTEXT_CHARACTERS,
  assistantContextScopes,
  assistantSelectionForRoute,
  boundedSelectedNoteContext,
} from '@/lib/assistant/context';
import {
  MAX_ASSISTANT_HISTORY_CHARACTERS,
  MAX_ASSISTANT_HISTORY_MESSAGES,
  boundedAssistantHistory,
} from '@/lib/assistant/history';

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
    expect(assistantSelectionForRoute('/planner', selection)).toBeUndefined();
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

describe('assistant context budgets', () => {
  it('keeps only the newest complete messages within the history budget', () => {
    const history = Array.from({ length: MAX_ASSISTANT_HISTORY_MESSAGES + 2 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `message-${index}`,
    }));

    const retained = boundedAssistantHistory(history);

    expect(retained).toHaveLength(MAX_ASSISTANT_HISTORY_MESSAGES);
    expect(retained[0]?.content).toBe('message-2');
    expect(
      boundedAssistantHistory([
        { role: 'user', content: 'x'.repeat(MAX_ASSISTANT_HISTORY_CHARACTERS + 1) },
      ])
    ).toEqual([]);
  });

  it('bounds a selected note before it becomes assistant context', () => {
    const context = boundedSelectedNoteContext({
      id: 'note-1',
      title: 'Planning notes',
      version: 3,
      body_markdown: 'x'.repeat(MAX_SELECTED_NOTE_CONTEXT_CHARACTERS + 10),
    });

    expect(context).toMatchObject({
      id: 'note-1',
      title: 'Planning notes',
      version: 3,
      bodyMarkdownExcerpt: 'x'.repeat(MAX_SELECTED_NOTE_CONTEXT_CHARACTERS),
      bodyTruncated: true,
    });
  });
});
