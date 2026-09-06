import { describe, expect, it } from 'vitest';
import {
  boundedAssistantHistory,
  MAX_ASSISTANT_HISTORY_CHARACTERS,
  MAX_ASSISTANT_HISTORY_MESSAGES,
} from '@/lib/assistant/history';

describe('boundedAssistantHistory', () => {
  it('keeps the most recent complete turns within the prompt character budget', () => {
    const history = [
      { role: 'user' as const, content: 'old'.repeat(2_000) },
      { role: 'assistant' as const, content: 'middle'.repeat(1_000) },
      { role: 'user' as const, content: 'recent'.repeat(1_000) },
    ];

    expect(boundedAssistantHistory(history, 12_000)).toEqual(history.slice(1));
  });

  it('does not split a message when the next older turn would exceed the budget', () => {
    const history = [
      { role: 'user' as const, content: 'old' },
      { role: 'assistant' as const, content: 'recent' },
    ];

    expect(boundedAssistantHistory(history, 6)).toEqual([history[1]]);
  });

  it('keeps the existing message-count ceiling as a secondary bound', () => {
    const history = Array.from({ length: MAX_ASSISTANT_HISTORY_MESSAGES + 2 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: String(index),
    }));

    expect(boundedAssistantHistory(history, MAX_ASSISTANT_HISTORY_CHARACTERS)).toEqual(
      history.slice(-MAX_ASSISTANT_HISTORY_MESSAGES)
    );
  });
});
