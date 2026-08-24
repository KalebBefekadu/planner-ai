export type AssistantSafetyIntercept = {
  category: 'crisis';
  reply: string;
};

const directSelfHarmPatterns = [
  /\b(?:kill myself|end my life|take my own life|die by suicide)\b/i,
  /\b(?:i am|i'm|im|i feel like|i want to|i plan to|i'm going to|im going to)\b.{0,48}\b(?:suicide|self[- ]?harm|hurt myself)\b/i,
];

export function assistantSafetyIntercept(message: string): AssistantSafetyIntercept | null {
  if (!directSelfHarmPatterns.some((pattern) => pattern.test(message))) return null;
  return {
    category: 'crisis',
    reply:
      'I am sorry you are dealing with this. Planner AI is not crisis care. If you may act now, call local emergency services or go to the nearest emergency department. In the US or Canada, call or text 988; elsewhere, contact your local crisis line. Move away from anything you could use to hurt yourself and contact a trusted person who can stay with you now.',
  };
}
