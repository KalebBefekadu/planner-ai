import { describe, expect, it } from 'vitest';
import {
  applyOperationJournalEvent,
  classifyOperationRejection,
  createOperationJournalEntry,
  OperationJournalTransitionError,
  operationJournalEntrySchema,
  planOperationRecovery,
  type ClientOperationRequest,
} from '@/lib/operations/journal';
import { captureMatchesJournal, createQueuedCaptureOperation } from '@/lib/capture-queue';

const request: ClientOperationRequest = {
  operationId: 'operation-device-1-42',
  operationName: 'note.update',
  operationVersion: 1,
  deviceId: 'device-1',
  objectId: 'note-1',
  baseRevision: '7',
  dependencies: [],
  clientSequence: 42,
  schemaVersion: 1,
  requestedAt: '2026-08-25T12:00:00.000Z',
  payload: { title: 'Preserve this source' },
};

function sentEntry() {
  let entry = createOperationJournalEntry(request);
  entry = applyOperationJournalEvent(entry, { type: 'commit_local' });
  entry = applyOperationJournalEvent(entry, { type: 'enqueue' });
  return applyOperationJournalEvent(entry, { type: 'send' });
}

describe('Operation journal lifecycle', () => {
  it('creates an encrypted-queue-ready capture Operation without changing its source', () => {
    const entry = createQueuedCaptureOperation({
      id: '123e4567-e89b-42d3-a456-426614174000',
      rawText: 'Preserve this exact capture.',
      source: 'voice',
      deviceId: 'device-1',
      clientSequence: 1,
      requestedAt: '2026-08-25T12:00:00.000Z',
    });

    expect(entry).toMatchObject({
      status: 'queued',
      attempts: 0,
      request: {
        operationName: 'capture.create',
        operationVersion: 1,
        payload: { rawText: 'Preserve this exact capture.', source: 'voice' },
      },
    });
  });

  it('detects local or server payload mismatch before discarding source data', () => {
    const entry = createQueuedCaptureOperation({
      id: '123e4567-e89b-42d3-a456-426614174000',
      rawText: 'Original exact capture.',
      source: 'typed',
      deviceId: 'device-1',
      clientSequence: 1,
      requestedAt: '2026-08-25T12:00:00.000Z',
    });

    expect(captureMatchesJournal(entry, 'Original exact capture.', 'typed')).toBe(true);
    expect(captureMatchesJournal(entry, 'Different capture.', 'typed')).toBe(false);
    expect(captureMatchesJournal(entry, 'Original exact capture.', 'voice')).toBe(false);
    expect(applyOperationJournalEvent(entry, { type: 'preserve_private_copy' }).status).toBe(
      'preserved_private_copy'
    );
  });

  it('rejects invalid or forged request context before local commit', () => {
    expect(() =>
      createOperationJournalEntry({ ...request, actorId: 'forged-user' } as never)
    ).toThrow();
    expect(() => createOperationJournalEntry({ ...request, operationVersion: 0 })).toThrow();
    expect(() => createOperationJournalEntry({ ...request, requestedAt: 'tomorrow' })).toThrow();
  });

  it('follows the successful local-first lifecycle', () => {
    const sent = sentEntry();
    const accepted = applyOperationJournalEvent(sent, {
      type: 'accept',
      receiptId: 'receipt-1',
    });

    expect(sent).toMatchObject({ status: 'sent', attempts: 1 });
    expect(accepted).toMatchObject({
      status: 'accepted',
      attempts: 1,
      receiptId: 'receipt-1',
    });
    expect(accepted.request.payload).toEqual(request.payload);
  });

  it('accepts a duplicate delivery without applying it again', () => {
    const accepted = applyOperationJournalEvent(sentEntry(), {
      type: 'accept_duplicate',
      receiptId: 'receipt-original',
    });
    expect(accepted.status).toBe('duplicate_accepted');
    expect(accepted.receiptId).toBe('receipt-original');
  });

  it('retries transport failure without dropping the local payload', () => {
    const rejected = applyOperationJournalEvent(sentEntry(), {
      type: 'reject',
      kind: 'retryable',
      code: 'network_error',
    });
    const queued = applyOperationJournalEvent(rejected, { type: 'retry' });

    expect(rejected.status).toBe('retryable_rejection');
    expect(queued).toMatchObject({ status: 'queued', rejection: undefined, attempts: 1 });
    expect(queued.request.payload).toEqual(request.payload);
  });

  it('allows a conflict to rebase or preserve a private recovery copy', () => {
    const rejected = applyOperationJournalEvent(sentEntry(), {
      type: 'reject',
      kind: 'conflict',
      code: 'version_conflict',
    });
    expect(applyOperationJournalEvent(rejected, { type: 'rebase' }).status).toBe('queued');
    expect(applyOperationJournalEvent(rejected, { type: 'preserve_private_copy' }).status).toBe(
      'preserved_private_copy'
    );
  });

  it('requires a private copy after a policy rejection', () => {
    const rejected = applyOperationJournalEvent(sentEntry(), {
      type: 'reject',
      kind: 'policy',
      code: 'workspace_access_revoked',
    });
    expect(rejected.status).toBe('policy_rejection');
    expect(applyOperationJournalEvent(rejected, { type: 'preserve_private_copy' }).status).toBe(
      'preserved_private_copy'
    );
    expect(() => applyOperationJournalEvent(rejected, { type: 'retry' })).toThrow(
      OperationJournalTransitionError
    );
  });

  it('halts obsolete clients until their schema is upgraded', () => {
    const rejected = applyOperationJournalEvent(sentEntry(), {
      type: 'reject',
      kind: 'obsolete_schema',
      code: 'schema_version_unsupported',
    });
    expect(rejected.status).toBe('obsolete_schema');
    expect(applyOperationJournalEvent(rejected, { type: 'require_upgrade' }).status).toBe(
      'needs_upgrade'
    );
  });

  it('rejects impossible transitions', () => {
    expect(() =>
      applyOperationJournalEvent(createOperationJournalEntry(request), { type: 'send' })
    ).toThrow(OperationJournalTransitionError);
  });

  it('rejects corrupted persisted journal data', () => {
    expect(() => operationJournalEntrySchema.parse({ ...sentEntry(), attempts: -1 })).toThrow();
    expect(() =>
      operationJournalEntrySchema.parse({ ...sentEntry(), status: 'forged_acceptance' })
    ).toThrow();
  });
});

describe('Operation rejection classification', () => {
  it.each([
    [{ code: 'network_error' }, 'retryable'],
    [{ httpStatus: 503 }, 'retryable'],
    [{ httpStatus: 429 }, 'retryable'],
    [{ code: 'version_conflict' }, 'conflict'],
    [{ httpStatus: 409 }, 'conflict'],
    [{ code: 'permission_denied' }, 'policy'],
    [{ httpStatus: 403 }, 'policy'],
    [{ code: 'operation_version_unsupported' }, 'obsolete_schema'],
    [{ httpStatus: 426 }, 'obsolete_schema'],
    [{ code: 'unknown_server_failure' }, 'retryable'],
  ] as const)('classifies %o as %s', (signal, expected) => {
    expect(classifyOperationRejection(signal)).toBe(expected);
  });
});

describe('Operation recovery planning', () => {
  it('automatically rebases disjoint changes', () => {
    expect(
      planOperationRecovery({
        rejection: 'conflict',
        localPaths: ['title'],
        remotePaths: ['bodyMarkdown'],
        localSourceAvailable: true,
      })
    ).toEqual({ action: 'automatic_rebase', preservesLocalSource: true });
  });

  it('requires a visible merge for overlapping changes', () => {
    expect(
      planOperationRecovery({
        rejection: 'conflict',
        localPaths: ['bodyMarkdown'],
        remotePaths: ['bodyMarkdown'],
        localSourceAvailable: true,
      })
    ).toEqual({ action: 'manual_merge', preservesLocalSource: true });
  });

  it('does not resurrect a remotely deleted target automatically', () => {
    expect(
      planOperationRecovery({
        rejection: 'conflict',
        targetDeleted: true,
        localSourceAvailable: true,
      })
    ).toEqual({ action: 'manual_merge', preservesLocalSource: true });
  });

  it('preserves recoverable source when workspace access is revoked', () => {
    expect(planOperationRecovery({ rejection: 'policy', localSourceAvailable: true })).toEqual({
      action: 'preserve_private_copy',
      preservesLocalSource: true,
    });
  });
});
