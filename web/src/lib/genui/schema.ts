import { z } from 'zod';
import { operationDefinitions, type OperationId } from '@/lib/operations';

export const GENUI_SCHEMA_VERSION = '1.0' as const;
export const GENUI_MAX_BYTES = 48_000;
export const GENUI_MAX_COMPONENTS = 12;

const componentId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const shortText = z.string().trim().min(1).max(300);
const bodyText = z.string().trim().min(1).max(2_000);
const internalHref = z.string().startsWith('/').max(300);

const textComponentSchema = z
  .object({
    id: componentId,
    kind: z.literal('text'),
    text: bodyText,
    tone: z.enum(['default', 'muted', 'positive', 'warning']).default('default'),
  })
  .strict();

const metricGroupComponentSchema = z
  .object({
    id: componentId,
    kind: z.literal('metric_group'),
    label: shortText.optional(),
    metrics: z
      .array(
        z
          .object({
            label: shortText,
            value: z.union([z.string().trim().min(1).max(80), z.number().finite()]),
            detail: shortText.optional(),
          })
          .strict()
      )
      .min(1)
      .max(4),
  })
  .strict();

const recordListComponentSchema = z
  .object({
    id: componentId,
    kind: z.literal('record_list'),
    label: shortText,
    records: z
      .array(
        z
          .object({
            id: componentId,
            title: shortText,
            subtitle: shortText.optional(),
            href: internalHref.optional(),
          })
          .strict()
      )
      .max(20),
  })
  .strict();

const operationProposalComponentSchema = z
  .object({
    id: componentId,
    kind: z.literal('operation_proposal'),
    operationId: z.string().min(1).max(120),
    input: z.record(z.string(), z.unknown()),
    summary: shortText,
    risk: z.enum(['read', 'low', 'medium', 'high']),
  })
  .strict();

const noticeComponentSchema = z
  .object({
    id: componentId,
    kind: z.literal('notice'),
    tone: z.enum(['info', 'success', 'warning', 'error']),
    title: shortText,
    body: bodyText,
  })
  .strict();

export const genUiComponentSchema = z.discriminatedUnion('kind', [
  textComponentSchema,
  metricGroupComponentSchema,
  recordListComponentSchema,
  operationProposalComponentSchema,
  noticeComponentSchema,
]);

export const genUiSpecSchema = z
  .object({
    schemaVersion: z.literal(GENUI_SCHEMA_VERSION),
    id: componentId,
    title: shortText.optional(),
    fallbackText: bodyText,
    components: z.array(genUiComponentSchema).min(1).max(GENUI_MAX_COMPONENTS),
  })
  .strict()
  .superRefine((spec, context) => {
    const componentIds = new Set<string>();
    for (const [componentIndex, component] of spec.components.entries()) {
      if (componentIds.has(component.id)) {
        context.addIssue({
          code: 'custom',
          path: ['components', componentIndex, 'id'],
          message: 'Component IDs must be unique.',
        });
      }
      componentIds.add(component.id);

      if (component.kind === 'record_list') {
        const recordIds = new Set<string>();
        for (const [recordIndex, record] of component.records.entries()) {
          if (recordIds.has(record.id)) {
            context.addIssue({
              code: 'custom',
              path: ['components', componentIndex, 'records', recordIndex, 'id'],
              message: 'Record IDs must be unique within a list.',
            });
          }
          recordIds.add(record.id);
        }
      }
    }
  });

export type GenUiSpec = z.output<typeof genUiSpecSchema>;
export type GenUiComponent = GenUiSpec['components'][number];
export type GenUiOperationProposal = Extract<GenUiComponent, { kind: 'operation_proposal' }>;

export type GenUiFallbackReason =
  | 'payload_too_large'
  | 'invalid_schema'
  | 'unknown_component'
  | 'unknown_operation'
  | 'operation_not_available'
  | 'invalid_operation_input'
  | 'risk_mismatch';

export type GenUiParseResult =
  | { ok: true; spec: GenUiSpec }
  | {
      ok: false;
      fallback: {
        title: string;
        message: string;
        reason: GenUiFallbackReason;
      };
    };

function safeFallbackText(input: unknown) {
  if (!input || typeof input !== 'object') return null;
  const fallbackText = (input as { fallbackText?: unknown }).fallbackText;
  if (typeof fallbackText !== 'string') return null;
  const trimmed = fallbackText.trim();
  return trimmed.length > 0 && trimmed.length <= 2_000 ? trimmed : null;
}

function fallback(input: unknown, reason: GenUiFallbackReason): GenUiParseResult {
  return {
    ok: false,
    fallback: {
      title: 'Interactive result unavailable',
      message:
        safeFallbackText(input) ??
        'Planner AI could not safely display this interactive result. No changes were made.',
      reason,
    },
  };
}

function payloadBytes(input: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(input)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function unknownComponent(input: unknown) {
  if (!input || typeof input !== 'object') return false;
  const components = (input as { components?: unknown }).components;
  if (!Array.isArray(components)) return false;
  const knownKinds = new Set([
    'text',
    'metric_group',
    'record_list',
    'operation_proposal',
    'notice',
  ]);
  return components.some(
    (component) =>
      component &&
      typeof component === 'object' &&
      typeof (component as { kind?: unknown }).kind === 'string' &&
      !knownKinds.has((component as { kind: string }).kind)
  );
}

export function parseGenUiSpec(input: unknown): GenUiParseResult {
  if (payloadBytes(input) > GENUI_MAX_BYTES) return fallback(input, 'payload_too_large');
  if (unknownComponent(input)) return fallback(input, 'unknown_component');

  const parsed = genUiSpecSchema.safeParse(input);
  if (!parsed.success) return fallback(input, 'invalid_schema');

  for (const component of parsed.data.components) {
    if (component.kind !== 'operation_proposal') continue;
    const operationId = component.operationId as OperationId;
    const definition = operationDefinitions[operationId];
    if (!definition) return fallback(input, 'unknown_operation');
    if (!definition.exposure.includes('chat' as never)) {
      return fallback(input, 'operation_not_available');
    }
    if (definition.risk !== component.risk) return fallback(input, 'risk_mismatch');
    if (!definition.input.safeParse(component.input).success) {
      return fallback(input, 'invalid_operation_input');
    }
  }

  return { ok: true, spec: parsed.data };
}
