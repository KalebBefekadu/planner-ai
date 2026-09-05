import { z } from 'zod';

export const operationJournalStatuses = [
  'draft',
  'locally_committed',
  'queued',
  'sent',
  'accepted',
  'duplicate_accepted',
  'retryable_rejection',
  'conflict_rejection',
  'policy_rejection',
  'preserved_private_copy',
  'obsolete_schema',
  'needs_upgrade',
] as const;

export type OperationJournalStatus = (typeof operationJournalStatuses)[number];

export type OperationRejectionKind = 'retryable' | 'conflict' | 'policy' | 'obsolete_schema';

export const clientOperationRequestSchema = z
  .object({
    operationId: z.string().trim().min(8).max(200),
    operationName: z.string().regex(/^[a-z][a-z0-9_.-]{2,119}$/),
    operationVersion: z.number().int().positive(),
    deviceId: z.string().trim().min(1).max(200),
    objectId: z.string().trim().min(1).max(200).optional(),
    baseRevision: z.string().trim().min(1).max(120).optional(),
    dependencies: z.array(z.string().trim().min(8).max(200)).max(100),
    clientSequence: z.number().int().nonnegative().safe(),
    schemaVersion: z.number().int().positive(),
    requestedAt: z.iso.datetime({ offset: true }),
    payload: z.unknown(),
  })
  .strict();

export type ClientOperationRequest = z.output<typeof clientOperationRequestSchema>;

export type OperationJournalEntry = {
  request: ClientOperationRequest;
  status: OperationJournalStatus;
  attempts: number;
  receiptId?: string;
  rejection?: {
    kind: OperationRejectionKind;
    code: string;
  };
};

export const operationJournalEntrySchema = z
  .object({
    request: clientOperationRequestSchema,
    status: z.enum(operationJournalStatuses),
    attempts: z.number().int().nonnegative().safe(),
    receiptId: z.string().trim().min(1).max(200).optional(),
    rejection: z
      .object({
        kind: z.enum(['retryable', 'conflict', 'policy', 'obsolete_schema']),
        code: z.string().trim().min(1).max(200),
      })
      .strict()
      .optional(),
  })
  .strict();

export type OperationJournalEvent =
  | { type: 'commit_local' }
  | { type: 'enqueue' }
  | { type: 'send' }
  | { type: 'accept'; receiptId: string }
  | { type: 'accept_duplicate'; receiptId: string }
  | { type: 'reject'; kind: OperationRejectionKind; code: string }
  | { type: 'retry' }
  | { type: 'rebase' }
  | { type: 'preserve_private_copy' }
  | { type: 'require_upgrade' };

const transitions: Record<
  OperationJournalStatus,
  Partial<Record<OperationJournalEvent['type'], OperationJournalStatus>>
> = {
  draft: { commit_local: 'locally_committed' },
  locally_committed: { enqueue: 'queued' },
  queued: { send: 'sent', preserve_private_copy: 'preserved_private_copy' },
  sent: {
    accept: 'accepted',
    accept_duplicate: 'duplicate_accepted',
    reject: 'retryable_rejection',
  },
  accepted: {},
  duplicate_accepted: {},
  retryable_rejection: { retry: 'queued' },
  conflict_rejection: { rebase: 'queued', preserve_private_copy: 'preserved_private_copy' },
  policy_rejection: { preserve_private_copy: 'preserved_private_copy' },
  preserved_private_copy: {},
  obsolete_schema: { require_upgrade: 'needs_upgrade' },
  needs_upgrade: {},
};

const rejectionStatuses: Record<OperationRejectionKind, OperationJournalStatus> = {
  retryable: 'retryable_rejection',
  conflict: 'conflict_rejection',
  policy: 'policy_rejection',
  obsolete_schema: 'obsolete_schema',
};

export class OperationJournalTransitionError extends Error {
  constructor(status: OperationJournalStatus, event: OperationJournalEvent['type']) {
    super(`Cannot apply ${event} while an Operation is ${status}.`);
    this.name = 'OperationJournalTransitionError';
  }
}

export function createOperationJournalEntry(
  request: ClientOperationRequest
): OperationJournalEntry {
  return operationJournalEntrySchema.parse({
    request: clientOperationRequestSchema.parse(request),
    status: 'draft',
    attempts: 0,
  });
}

export function applyOperationJournalEvent(
  entry: OperationJournalEntry,
  event: OperationJournalEvent
): OperationJournalEntry {
  let nextStatus = transitions[entry.status][event.type];

  if (event.type === 'reject' && entry.status === 'sent') {
    nextStatus = rejectionStatuses[event.kind];
  }

  if (!nextStatus) {
    throw new OperationJournalTransitionError(entry.status, event.type);
  }

  return {
    ...entry,
    status: nextStatus,
    attempts: event.type === 'send' ? entry.attempts + 1 : entry.attempts,
    receiptId:
      event.type === 'accept' || event.type === 'accept_duplicate'
        ? event.receiptId
        : entry.receiptId,
    rejection:
      event.type === 'reject'
        ? { kind: event.kind, code: event.code }
        : event.type === 'retry' || event.type === 'rebase'
          ? undefined
          : entry.rejection,
  };
}

const retryableCodes = new Set([
  'network_error',
  'request_timeout',
  'rate_limited',
  'service_unavailable',
  'gateway_timeout',
]);
const conflictCodes = new Set([
  'version_conflict',
  'version_conflict_or_not_found',
  'dependency_conflict',
  'target_deleted',
]);
const policyCodes = new Set([
  'approval_required',
  'authentication_required',
  'permission_denied',
  'workspace_access_revoked',
]);
const obsoleteSchemaCodes = new Set([
  'operation_version_unsupported',
  'schema_version_unsupported',
]);

export function classifyOperationRejection(signal: {
  code?: string;
  httpStatus?: number;
}): OperationRejectionKind {
  if (signal.code && conflictCodes.has(signal.code)) return 'conflict';
  if (signal.code && policyCodes.has(signal.code)) return 'policy';
  if (signal.code && obsoleteSchemaCodes.has(signal.code)) return 'obsolete_schema';
  if (signal.code && retryableCodes.has(signal.code)) return 'retryable';

  if (signal.httpStatus === 401 || signal.httpStatus === 403) return 'policy';
  if (signal.httpStatus === 409) return 'conflict';
  if (signal.httpStatus === 426) return 'obsolete_schema';
  if (signal.httpStatus === 408 || signal.httpStatus === 429) return 'retryable';
  if (signal.httpStatus && signal.httpStatus >= 500) return 'retryable';

  // Unknown failures retain the local effect and remain retryable until the
  // server returns a stable rejection code. This avoids silent data loss.
  return 'retryable';
}

export type OperationRecoveryPlan =
  | { action: 'retry_later'; preservesLocalSource: true }
  | { action: 'automatic_rebase'; preservesLocalSource: true }
  | { action: 'manual_merge'; preservesLocalSource: true }
  | { action: 'preserve_private_copy'; preservesLocalSource: true }
  | { action: 'remove_shared_effect'; preservesLocalSource: false }
  | { action: 'upgrade_required'; preservesLocalSource: true };

export function planOperationRecovery(input: {
  rejection: OperationRejectionKind;
  localPaths?: string[];
  remotePaths?: string[];
  targetDeleted?: boolean;
  localSourceAvailable: boolean;
}): OperationRecoveryPlan {
  if (input.rejection === 'retryable') {
    return { action: 'retry_later', preservesLocalSource: true };
  }
  if (input.rejection === 'obsolete_schema') {
    return { action: 'upgrade_required', preservesLocalSource: true };
  }
  if (input.rejection === 'policy') {
    return input.localSourceAvailable
      ? { action: 'preserve_private_copy', preservesLocalSource: true }
      : { action: 'remove_shared_effect', preservesLocalSource: false };
  }
  if (input.targetDeleted) {
    return input.localSourceAvailable
      ? { action: 'manual_merge', preservesLocalSource: true }
      : { action: 'remove_shared_effect', preservesLocalSource: false };
  }

  const localPaths = new Set(input.localPaths ?? []);
  const hasOverlap = (input.remotePaths ?? []).some((path) => localPaths.has(path));
  return hasOverlap
    ? { action: 'manual_merge', preservesLocalSource: true }
    : { action: 'automatic_rebase', preservesLocalSource: true };
}
