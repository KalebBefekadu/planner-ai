// Enough continuity for a focused exchange without resending stale conversation detail.
export const MAX_ASSISTANT_HISTORY_MESSAGES = 8;
export const MAX_ASSISTANT_HISTORY_CHARACTERS = 8_000;

export type AssistantHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

// Keep the most recent complete turns so a long conversation cannot grow every prompt indefinitely.
export function boundedAssistantHistory(
  history: AssistantHistoryMessage[],
  maxCharacters = MAX_ASSISTANT_HISTORY_CHARACTERS
) {
  const retained: AssistantHistoryMessage[] = [];
  let characters = 0;

  for (const message of history.slice(-MAX_ASSISTANT_HISTORY_MESSAGES).reverse()) {
    if (characters + message.content.length > maxCharacters) break;
    retained.push(message);
    characters += message.content.length;
  }

  return retained.reverse();
}
