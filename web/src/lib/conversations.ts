export type TranscriptMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
};

export function formatConversationTranscript(title: string, messages: TranscriptMessage[]) {
  const transcript = messages
    .map((message) => {
      const role =
        message.role === 'user' ? 'You' : message.role === 'tool' ? 'Tool' : 'Planner AI';
      return `## ${role}\n\n${message.content}`;
    })
    .join('\n\n');
  return `# ${title}\n\n${transcript}`;
}
