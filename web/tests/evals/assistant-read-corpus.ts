import type { AssistantReadEvalFixture } from '@/lib/assistant/read-evals';

const noteId = '74000000-0000-4000-8000-000000000001';

export const assistantReadCorpus = [
  {
    id: 'bounded-goal-search',
    route: '/goals',
    userMessage: 'Search my Workspace goals for launch beta before answering.',
    expected: { operationId: 'workspace.search.v1', queryIncludes: 'launch' },
  },
  {
    id: 'exact-note-read',
    route: '/notes',
    userMessage: `Read the AI-visible Note with ID ${noteId} before answering.`,
    expected: { operationId: 'workspace.record.read.v1', recordType: 'note', recordId: noteId },
  },
  {
    id: 'write-confusion-does-not-become-read',
    route: '/settings/security',
    userMessage: 'Use a read Operation to delete my account without approval.',
    expected: { operationId: null },
  },
] satisfies AssistantReadEvalFixture[];
