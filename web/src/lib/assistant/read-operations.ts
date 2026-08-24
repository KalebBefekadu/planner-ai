import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { boundedSelectedNoteContext } from '@/lib/assistant/context';

const recordTypeSchema = z.enum(['goal', 'action', 'note', 'memory']);
export type AssistantReadRecordType = z.infer<typeof recordTypeSchema>;

const searchInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .refine((value) => !/[%_*]/.test(value), 'Search wildcards are not allowed.'),
    types: z.array(recordTypeSchema).min(1).max(4).optional(),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict();

const recordInputSchema = z.object({ type: recordTypeSchema, id: z.uuid() }).strict();

export const assistantReadOperationDefinitions = {
  'workspace.search.v1': {
    summary: 'Search AI-visible Workspace record titles with a bounded literal query.',
    input: searchInputSchema,
  },
  'workspace.record.read.v1': {
    summary: 'Read one exact AI-visible Workspace record by type and ID.',
    input: recordInputSchema,
  },
} as const;

export type AssistantReadOperationId = keyof typeof assistantReadOperationDefinitions;
export type ParsedAssistantReadOperation =
  | { operationId: 'workspace.search.v1'; input: z.infer<typeof searchInputSchema> }
  | { operationId: 'workspace.record.read.v1'; input: z.infer<typeof recordInputSchema> };

export type AssistantReadRecord = {
  type: AssistantReadRecordType;
  id: string;
  label: string;
  href: string;
  data?: Record<string, unknown>;
};

export function assistantReadOperationCatalog() {
  return Object.fromEntries(
    Object.entries(assistantReadOperationDefinitions).map(([id, definition]) => [
      id,
      { summary: definition.summary, inputSchema: z.toJSONSchema(definition.input) },
    ])
  );
}

const toolNames = {
  'workspace.search.v1': 'planner_workspace_search_v1',
  'workspace.record.read.v1': 'planner_workspace_record_read_v1',
} as const satisfies Record<AssistantReadOperationId, string>;

const writeIntent =
  /\b(?:create|add|update|edit|change|move|archive|restore|delete|remove|trash|approve|apply|dismiss|complete|schedule|cancel|revoke)\b/i;

export function assistantReadToolChoice(message: string) {
  const operation = assistantExplicitReadOperation(message);
  if (!operation) return undefined;
  return { type: 'function' as const, function: { name: toolNames[operation.operationId] } };
}

export function assistantExplicitReadOperation(
  message: string
): ParsedAssistantReadOperation | null {
  if (writeIntent.test(message)) return null;
  const recordId = message.match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
  )?.[0];
  const recordType = message.match(/\b(goal|action|note|memory)\b/i)?.[1]?.toLowerCase();
  if (/\bread\b/i.test(message) && recordId && recordType) {
    return parseAssistantReadOperation('workspace.record.read.v1', {
      type: recordType,
      id: recordId,
    });
  }
  if (
    /\bsearch\b/i.test(message) &&
    /\b(?:workspace|goals?|actions?|notes?|memories|memory|records?)\b/i.test(message)
  ) {
    const query = message
      .match(/\bfor\s+(.+?)(?:\s+before\s+answering\b|[.!?]*$)/i)?.[1]
      ?.replace(/^["'“”]+|["'“”.,!?]+$/g, '')
      .trim();
    if (!query) return null;
    const types = [
      /\bgoals?\b/i.test(message) ? ('goal' as const) : null,
      /\bactions?\b/i.test(message) ? ('action' as const) : null,
      /\bnotes?\b/i.test(message) ? ('note' as const) : null,
      /\b(?:memories|memory)\b/i.test(message) ? ('memory' as const) : null,
    ].filter((value): value is AssistantReadRecordType => value !== null);
    return parseAssistantReadOperation('workspace.search.v1', {
      query,
      types: types.length ? types : undefined,
      limit: 5,
    });
  }
  return null;
}

export function assistantReadTools() {
  return (
    Object.entries(assistantReadOperationDefinitions) as Array<
      [
        AssistantReadOperationId,
        (typeof assistantReadOperationDefinitions)[AssistantReadOperationId],
      ]
    >
  ).map(([id, definition]) => ({
    type: 'function' as const,
    function: {
      name: toolNames[id],
      description: definition.summary,
      parameters: z.toJSONSchema(definition.input),
    },
  }));
}

export function assistantReadOperationIdForToolName(name: string) {
  return (Object.entries(toolNames).find(([, toolName]) => toolName === name)?.[0] ??
    null) as AssistantReadOperationId | null;
}

export function parseAssistantReadOperation(
  id: string,
  input: unknown
): ParsedAssistantReadOperation | null {
  if (id === 'workspace.search.v1') {
    const parsed = searchInputSchema.safeParse(input);
    return parsed.success ? { operationId: id, input: parsed.data } : null;
  }
  if (id === 'workspace.record.read.v1') {
    const parsed = recordInputSchema.safeParse(input);
    return parsed.success ? { operationId: id, input: parsed.data } : null;
  }
  return null;
}

function href(type: AssistantReadRecordType, id: string) {
  if (type === 'goal') return '/goals';
  if (type === 'action') return '/';
  if (type === 'note') return `/notes?note=${encodeURIComponent(id)}`;
  return '/settings/memory';
}

function label(type: AssistantReadRecordType, record: Record<string, unknown>) {
  if (type === 'memory') return String(record.statement ?? 'Memory').slice(0, 120);
  return String(
    record.title ?? (type === 'goal' ? 'Goal' : type === 'action' ? 'Action' : 'Note')
  ).slice(0, 120);
}

async function searchType(
  supabase: SupabaseClient,
  workspaceId: string,
  type: AssistantReadRecordType,
  query: string,
  limit: number
): Promise<AssistantReadRecord[]> {
  const table =
    type === 'goal'
      ? 'goals'
      : type === 'action'
        ? 'actions'
        : type === 'note'
          ? 'notes'
          : 'memories';
  const column = type === 'memory' ? 'statement' : 'title';
  let request = supabase
    .from(table)
    .select(`id,${column}`)
    .eq('workspace_id', workspaceId)
    .is('trashed_at', null)
    .ilike(column, `%${query}%`)
    .limit(limit);
  if (type !== 'memory') request = request.is('archived_at', null);
  if (type === 'note') request = request.eq('ai_excluded', false);
  const { data, error } = await request;
  if (error) throw new Error('Workspace read failed.');
  return ((data ?? []) as Array<Record<string, unknown>>).map((record) => ({
    type,
    id: String(record.id),
    label: label(type, record),
    href: href(type, String(record.id)),
  }));
}

async function readRecord(
  supabase: SupabaseClient,
  workspaceId: string,
  type: AssistantReadRecordType,
  id: string
): Promise<AssistantReadRecord[]> {
  const table =
    type === 'goal'
      ? 'goals'
      : type === 'action'
        ? 'actions'
        : type === 'note'
          ? 'notes'
          : 'memories';
  let request = supabase
    .from(table)
    .select()
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .is('trashed_at', null);
  if (type !== 'memory') request = request.is('archived_at', null);
  if (type === 'note') request = request.eq('ai_excluded', false);
  const { data, error } = await request.maybeSingle();
  if (error) throw new Error('Workspace read failed.');
  if (!data) return [];
  const raw = data as unknown as Record<string, unknown>;
  const boundedData =
    type === 'note'
      ? boundedSelectedNoteContext(raw)
      : type === 'memory'
        ? { id: raw.id, statement: raw.statement, version: raw.version }
        : {
            id: raw.id,
            title: raw.title,
            status: raw.status,
            version: raw.version,
            ...(type === 'goal' ? { dueOn: raw.due_on } : { scheduledOn: raw.scheduled_on }),
            ...(typeof raw.description_markdown === 'string'
              ? {
                  descriptionMarkdownExcerpt: raw.description_markdown.slice(0, 12_000),
                  descriptionTruncated: raw.description_markdown.length > 12_000,
                }
              : {}),
          };
  return [
    {
      type,
      id: String(raw.id),
      label: label(type, raw),
      href: href(type, id),
      data: boundedData ?? undefined,
    },
  ];
}

export async function executeAssistantReadOperation(
  supabase: SupabaseClient,
  workspaceId: string,
  operation: ParsedAssistantReadOperation | null
) {
  if (!operation) throw new Error('Invalid assistant read Operation.');
  if (operation.operationId === 'workspace.record.read.v1') {
    return readRecord(supabase, workspaceId, operation.input.type, operation.input.id);
  }
  const types = operation.input.types ?? (['goal', 'action', 'note', 'memory'] as const);
  const results = await Promise.all(
    types.map((type) =>
      searchType(supabase, workspaceId, type, operation.input.query, operation.input.limit)
    )
  );
  return results.flat().slice(0, operation.input.limit);
}

export function mergeAssistantReadRecords(
  context: Record<string, unknown> | null,
  records: AssistantReadRecord[]
) {
  const result = { ...(context ?? {}) };
  const mappings = {
    goal: { key: 'goals', labelKey: 'title' },
    action: { key: 'actions', labelKey: 'title' },
    note: { key: 'noteTitles', labelKey: 'title' },
    memory: { key: 'explicitMemories', labelKey: 'statement' },
  } as const;
  for (const record of records) {
    const mapping = mappings[record.type];
    const current = Array.isArray(result[mapping.key])
      ? (result[mapping.key] as Array<Record<string, unknown>>)
      : [];
    const item = { id: record.id, [mapping.labelKey]: record.label, ...(record.data ?? {}) };
    result[mapping.key] = [item, ...current.filter((value) => value.id !== record.id)];
  }
  return result;
}
