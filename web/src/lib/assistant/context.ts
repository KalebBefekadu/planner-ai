export type AssistantSelection = {
  type: 'note';
  id: string;
};

export type AssistantContextScope =
  | 'actionTemplates'
  | 'actions'
  | 'captureProposalBatches'
  | 'conversations'
  | 'goals'
  | 'memories'
  | 'notes'
  | 'notifications'
  | 'todayFocus'
  | 'vision';

export const MAX_SELECTED_NOTE_CONTEXT_CHARACTERS = 8_000;

const routeScopes: Array<[prefix: string, scopes: AssistantContextScope[]]> = [
  ['/planner', ['vision', 'goals', 'actions', 'actionTemplates', 'memories']],
  ['/vision', ['vision', 'goals', 'memories']],
  ['/inbox', ['goals', 'notes', 'captureProposalBatches', 'memories']],
  ['/notes', ['notes', 'goals', 'actions', 'memories']],
  ['/notifications', ['notifications', 'memories']],
  ['/review', ['goals', 'actions', 'todayFocus', 'memories']],
  ['/conversations', ['conversations', 'memories']],
  ['/settings/memory', ['memories']],
  [
    '/',
    ['vision', 'goals', 'actions', 'todayFocus', 'actionTemplates', 'notifications', 'memories'],
  ],
];

export function assistantContextScopes(route: string) {
  const normalized = route.split(/[?#]/, 1)[0] || '/';
  const match = routeScopes.find(([prefix]) =>
    prefix === '/'
      ? normalized === '/'
      : normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
  return new Set<AssistantContextScope>(match?.[1] ?? ['memories']);
}

export function assistantSelectionForRoute(route: string, selection?: AssistantSelection) {
  if (!selection || selection.type !== 'note') return undefined;
  return route.split(/[?#]/, 1)[0] === '/notes' ? selection : undefined;
}

export function boundedSelectedNoteContext(
  value: unknown,
  maximumCharacters = MAX_SELECTED_NOTE_CONTEXT_CHARACTERS
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const note = value as Record<string, unknown>;
  const body = typeof note.body_markdown === 'string' ? note.body_markdown : '';
  return {
    id: note.id,
    title: note.title,
    version: note.version,
    bodyMarkdownExcerpt: body.slice(0, maximumCharacters),
    bodyTruncated: body.length > maximumCharacters,
  };
}
