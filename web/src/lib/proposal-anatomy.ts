/* The parts of the Operation proposal anatomy (direction doc §18.1) that can
   be derived from a proposal itself: the kind of each change, the exact object
   count, one risk level for the whole batch, and the proposed values.

   What is deliberately absent: the before-value of an update, and an
   evidence-versus-inference label. Neither is carried on the proposal view, so
   showing them would mean inventing them. They need the proposal record to
   grow those columns first. */

export type ChangeKind = 'create' | 'update' | 'move' | 'remove' | 'link';
export type RiskClass = 'low' | 'medium' | 'high';

export type ProposalLike = {
  id: string;
  operationId: string;
  input: Record<string, unknown>;
  risk: RiskClass;
};

export const RISK_DETAIL: Record<RiskClass, string> = {
  low: 'Reversible from Activity. Nothing is removed.',
  medium: 'Changes dated commitments. Reversible from Activity.',
  high: 'Removes or reassigns work. Read each row before applying.',
};

export function operationLabel(operationId: string) {
  return operationId
    .replace(/\.v\d+$/, '')
    .split('.')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

export function changeKind(operationId: string): ChangeKind {
  const verb = operationId
    .replace(/\.v\d+$/, '')
    .split('.')
    .slice(1)
    .join('.');
  if (verb.startsWith('create') || verb === 'upsert' || verb === 'materialize') return 'create';
  if (verb.startsWith('move') || verb.startsWith('file-to')) return 'move';
  if (verb.startsWith('archive') || verb.startsWith('dismiss') || verb.startsWith('unlink'))
    return 'remove';
  if (verb.startsWith('link') || verb.endsWith('-link')) return 'link';
  return 'update';
}

export function highestRisk(items: readonly ProposalLike[]): RiskClass {
  if (items.some((item) => item.risk === 'high')) return 'high';
  if (items.some((item) => item.risk === 'medium')) return 'medium';
  return 'low';
}

const TARGET_KEYS = ['id', 'goalId', 'actionId', 'noteId', 'visionId', 'captureId'] as const;

/* Two proposals can touch the same record, so the object count is the number
   of distinct targets rather than the number of rows. */
export function distinctObjects(items: readonly ProposalLike[]) {
  const keys = items.map((item) => {
    const key = TARGET_KEYS.find((candidate) => typeof item.input[candidate] === 'string');
    return key ? `${item.operationId.split('.')[0]}:${String(item.input[key])}` : item.id;
  });
  return new Set(keys).size;
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  bodyMarkdown: 'Note',
  horizonKind: 'Planning period',
  startsOn: 'Starts',
  endsOn: 'Ends',
  scheduledOn: 'Scheduled',
  status: 'Status',
  tags: 'Tags',
};

const MAX_FIELD_LENGTH = 160;

/* The "after" side of the change, read off the operation input. Long bodies
   are left out — a proposal row is a summary, not the editor. */
export function proposedFields(input: Record<string, unknown>) {
  return Object.entries(FIELD_LABELS)
    .filter(([key]) => key in input && input[key] !== null && input[key] !== '')
    .map(([key, label]) => {
      const value = input[key];
      return { label, value: Array.isArray(value) ? value.join(', ') : String(value) };
    })
    .filter((field) => field.value.length > 0 && field.value.length <= MAX_FIELD_LENGTH);
}
