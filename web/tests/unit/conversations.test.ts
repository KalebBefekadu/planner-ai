import { describe, expect, it } from 'vitest';
import { formatConversationTranscript } from '@/lib/conversations';

describe('conversation promotion', () => {
  it('preserves message order and identifies every durable role', () => {
    expect(
      formatConversationTranscript('Quarterly direction', [
        { role: 'user', content: 'Start with retention.' },
        { role: 'assistant', content: 'I can turn that into a Goal.' },
        { role: 'tool', content: 'Goal proposal prepared.' },
      ])
    ).toBe(
      '# Quarterly direction\n\n' +
        '## You\n\nStart with retention.\n\n' +
        '## Planner AI\n\nI can turn that into a Goal.\n\n' +
        '## Tool\n\nGoal proposal prepared.'
    );
  });

  it('does not invent transcript content for an empty conversation', () => {
    expect(formatConversationTranscript('New conversation', [])).toBe('# New conversation\n\n');
  });
});
