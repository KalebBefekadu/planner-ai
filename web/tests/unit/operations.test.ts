import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  executeOperation,
  OperationFailure,
  operationDefinitions,
  undoableOperationIds,
} from '@/lib/operations';
import { mcpOperationIds } from '@/lib/mcp/catalog';

const capture = {
  id: '10000000-0000-4000-8000-000000000001',
  workspace_id: '20000000-0000-4000-8000-000000000001',
  raw_text: '  Preserve this exactly.  ',
  source: 'typed',
  state: 'new',
  created_at: '2026-08-16T12:00:00.000Z',
  archived_at: null,
  trashed_at: null,
};

describe('operation registry', () => {
  it('defines a versioned, bounded contract for every operation', () => {
    for (const [operationId, definition] of Object.entries(operationDefinitions)) {
      expect(operationId).toMatch(/\.v\d+$/);
      expect(definition.summary.length).toBeGreaterThan(10);
      expect(definition.exposure).toContain('ui');
      if (definition.risk === 'high') {
        expect(definition.exposure).not.toContain('mcp');
      }
    }
  });

  it('preserves raw Capture whitespace through the contract', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: capture, error: null });
    const client = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>;

    const output = await executeOperation(
      client,
      'capture.create.v1',
      { rawText: capture.raw_text, source: 'typed' },
      { idempotencyKey: 'capture-test-0001', surface: 'ui' }
    );

    expect(output.raw_text).toBe(capture.raw_text);
    expect(rpc).toHaveBeenCalledWith(
      'execute_ui_operation',
      expect.objectContaining({ p_input: { rawText: capture.raw_text, source: 'typed' } })
    );
  });

  it('rejects forged fields before the database call', async () => {
    const rpc = vi.fn();
    const client = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>;

    await expect(
      executeOperation(
        client,
        'capture.create.v1',
        { rawText: 'A valid thought', source: 'typed', workspaceId: 'forged' } as never,
        { idempotencyKey: 'capture-test-0002', surface: 'ui' }
      )
    ).rejects.toMatchObject({ code: 'invalid_input' } satisfies Partial<OperationFailure>);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('keeps chat and MCP writes behind their trusted gateways', async () => {
    const rpc = vi.fn();
    const client = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>;

    await expect(
      executeOperation(
        client,
        'capture.create.v1',
        { rawText: 'A deliberate thought', source: 'typed' },
        { idempotencyKey: 'trusted-gateway-0001', surface: 'mcp' }
      )
    ).rejects.toMatchObject({
      code: 'trusted_gateway_required',
    } satisfies Partial<OperationFailure>);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['short', 'x'.repeat(201)])('rejects unsafe idempotency keys', async (idempotencyKey) => {
    const rpc = vi.fn();
    const client = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>;

    await expect(
      executeOperation(
        client,
        'capture.create.v1',
        { rawText: 'A deliberate thought', source: 'typed' },
        { idempotencyKey, surface: 'ui' }
      )
    ).rejects.toMatchObject({
      code: 'invalid_idempotency_key',
    } satisfies Partial<OperationFailure>);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects malformed database output before it reaches the UI', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'not-a-uuid' }, error: null });
    const client = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>;

    await expect(
      executeOperation(
        client,
        'capture.create.v1',
        { rawText: 'A deliberate thought', source: 'typed' },
        { idempotencyKey: 'invalid-output-0001', surface: 'ui' }
      )
    ).rejects.toMatchObject({ code: 'invalid_output' } satisfies Partial<OperationFailure>);
  });

  it('maps concurrency errors to a stable user-safe failure', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'version_conflict_or_not_found' },
    });
    const client = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>;

    await expect(
      executeOperation(
        client,
        'action.status.v1',
        {
          id: '10000000-0000-4000-8000-000000000001',
          status: 'done',
          expectedVersion: 1,
        },
        { idempotencyKey: 'action-status-0001', surface: 'ui' }
      )
    ).rejects.toMatchObject({ code: 'version_conflict' } satisfies Partial<OperationFailure>);
  });

  it.each([
    ['authentication_required', 'authentication_required'],
    ['permission denied for function execute_ui_operation', 'permission_denied'],
    ['workspace_access_revoked', 'workspace_access_revoked'],
    ['operation_version_unsupported', 'operation_version_unsupported'],
    ['schema_version_unsupported', 'schema_version_unsupported'],
  ])('preserves stable policy and schema failure %s as %s', async (message, code) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message } });
    const client = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>;

    await expect(
      executeOperation(
        client,
        'capture.create.v1',
        { rawText: 'Preserve this Capture', source: 'typed' },
        { idempotencyKey: 'capture-policy-test', surface: 'ui' }
      )
    ).rejects.toMatchObject({ code } satisfies Partial<OperationFailure>);
  });

  it('preserves optional raw Capture text through guided onboarding', async () => {
    const rawText = '  Keep this first thought exact.  ';
    const rpc = vi.fn().mockResolvedValue({
      data: {
        workspaceId: '20000000-0000-4000-8000-000000000001',
        onboardingCompletedAt: '2026-08-17T12:00:00.000Z',
        visionId: null,
        goalId: null,
        actionId: null,
        captureId: '10000000-0000-4000-8000-000000000001',
      },
      error: null,
    });
    const client = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>;

    await executeOperation(
      client,
      'workspace.onboarding-complete.v1',
      {
        timezone: 'America/New_York',
        weekStartsOn: 1,
        coachingIntensity: 'direct',
        aiEnabled: true,
        weeklyReviewDay: 0,
        today: '2026-08-17',
        visionText: null,
        goalTitle: null,
        actionTitle: null,
        captureText: rawText,
      },
      { idempotencyKey: 'guided-onboarding-0001', surface: 'ui' }
    );

    expect(rpc).toHaveBeenCalledWith(
      'execute_ui_operation',
      expect.objectContaining({ p_input: expect.objectContaining({ captureText: rawText }) })
    );
  });

  it('validates a receipt-scoped undo result', async () => {
    const originalReceiptId = '30000000-0000-4000-8000-000000000001';
    const undoReceiptId = '30000000-0000-4000-8000-000000000002';
    const rpc = vi.fn().mockResolvedValue({
      data: { originalReceiptId, undoReceiptId, status: 'undone' },
      error: null,
    });
    const client = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>;

    await expect(
      executeOperation(
        client,
        'operation.undo.v1',
        { receiptId: originalReceiptId },
        { idempotencyKey: 'operation-undo-0001', surface: 'ui' }
      )
    ).resolves.toEqual({ originalReceiptId, undoReceiptId, status: 'undone' });
  });

  it('advertises only Operations with implemented conflict-safe inverses', () => {
    expect(undoableOperationIds).toEqual(
      expect.arrayContaining([
        'vision.upsert.v1',
        'note.create.v1',
        'note.update.v1',
        'note.move.v1',
        'note.archive.v1',
        'note.ai-exclusion.v1',
        'note.import-preview.v1',
        'note.import-commit.v1',
        'note.tags.set.v1',
        'note.unlink.v1',
        'note.goal-unlink.v1',
        'note.action-unlink.v1',
        'goal.update.v1',
        'goal.status.v1',
        'goal.archive.v1',
        'action.update.v1',
        'action.move.v1',
        'action.status.v1',
        'action.archive.v1',
        'action-template.create.v1',
        'action-template.update.v1',
        'action-template.status.v1',
        'action-template.materialize.v1',
        'action-template.archive.v1',
        'notification.refresh.v1',
        'notification.read.v1',
        'notification.dismiss.v1',
        'notification.preferences.v1',
        'conversation.rename.v1',
        'conversation.status.v1',
        'capture-proposal.item-update.v1',
        'capture-proposal.dismiss.v1',
        'capture.file-to-note.v1',
        'daily-focus.set.v1',
        'memory.update.v1',
        'workspace.preferences.v1',
        'workspace.onboarding-complete.v1',
        'workspace.ai-budget.v1',
        'trash.move.v1',
        'trash.restore.v1',
        'review.complete-period.v1',
        'review.complete-weekly.v1',
        'account.deletion.schedule.v1',
      ])
    );
    expect(undoableOperationIds).not.toContain('account.deletion.cancel.v1');
    expect(undoableOperationIds).not.toContain('conversation.delete.v1');
    expect(undoableOperationIds).not.toContain('capture-proposal.apply.v1');
  });

  it('requires exact confirmation and keeps conversation deletion off MCP', async () => {
    const id = '10000000-0000-4000-8000-000000000001';
    const rpc = vi.fn().mockResolvedValue({ data: { id, deleted: true }, error: null });
    const client = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>;

    await expect(
      executeOperation(
        client,
        'conversation.delete.v1',
        { id, expectedVersion: 1, confirmation: 'delete' } as never,
        { idempotencyKey: 'conversation-delete-test-0001', surface: 'ui' }
      )
    ).rejects.toMatchObject({ code: 'invalid_input' } satisfies Partial<OperationFailure>);
    await expect(
      executeOperation(
        client,
        'conversation.delete.v1',
        { id, expectedVersion: 1, confirmation: 'DELETE CONVERSATION' },
        { idempotencyKey: 'conversation-delete-test-0002', surface: 'ui' }
      )
    ).resolves.toEqual({ id, deleted: true });
    expect(mcpOperationIds).not.toContain('conversation.delete.v1');
  });

  it('enforces Memory source shape before a proposal reaches the database', () => {
    const schema = operationDefinitions['memory.create.v1'].input;
    expect(
      schema.safeParse({ statement: 'User preference', sourceType: 'user', sourceId: null }).success
    ).toBe(true);
    expect(
      schema.safeParse({
        statement: 'Invalid user source',
        sourceType: 'user',
        sourceId: '10000000-0000-4000-8000-000000000001',
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({ statement: 'Missing source', sourceType: 'conversation', sourceId: null })
        .success
    ).toBe(false);
  });

  it('keeps recurring Action generation bounded and date-only', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: '10000000-0000-4000-8000-000000000001',
        workspaceId: '20000000-0000-4000-8000-000000000001',
        title: 'Publish a weekly progress note',
        cadence: 'weekly',
        status: 'active',
        nextOccurrenceOn: '2026-08-24',
        version: 2,
        createdActionIds: ['30000000-0000-4000-8000-000000000001'],
      },
      error: null,
    });
    const client = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>;

    await executeOperation(
      client,
      'action-template.materialize.v1',
      {
        id: '10000000-0000-4000-8000-000000000001',
        expectedVersion: 1,
        throughOn: '2026-08-17',
      },
      { idempotencyKey: 'template-materialize-test-0001', surface: 'ui' }
    );

    expect(rpc).toHaveBeenCalledWith(
      'execute_ui_operation',
      expect.objectContaining({
        p_operation_id: 'action-template.materialize.v1',
        p_input: expect.objectContaining({ throughOn: '2026-08-17' }),
      })
    );
    await expect(
      executeOperation(
        client,
        'action-template.materialize.v1',
        {
          id: '10000000-0000-4000-8000-000000000001',
          expectedVersion: 1,
          throughOn: 'not-a-date',
        },
        { idempotencyKey: 'template-materialize-test-0002', surface: 'ui' }
      )
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('exposes recurring Actions to MCP without widening UI-only authority', () => {
    expect(mcpOperationIds).toEqual(
      expect.arrayContaining([
        'action-template.create.v1',
        'action-template.update.v1',
        'action-template.status.v1',
        'action-template.materialize.v1',
        'action-template.archive.v1',
      ])
    );
    expect(mcpOperationIds).not.toContain('workspace.onboarding-complete.v1');
    expect(mcpOperationIds).not.toContain('account.deletion.schedule.v1');
  });

  it('keeps notification state changes versioned and reminder windows bounded', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        workspaceId: '20000000-0000-4000-8000-000000000001',
        inAppEnabled: true,
        emailEnabled: true,
        emailHour: 9,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      },
      error: null,
    });
    const client = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>;

    await executeOperation(
      client,
      'notification.preferences.v1',
      {
        inAppEnabled: true,
        emailEnabled: true,
        emailHour: 9,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      },
      { idempotencyKey: 'notification-preferences-test-0001', surface: 'ui' }
    );

    expect(rpc).toHaveBeenCalledWith(
      'execute_ui_operation',
      expect.objectContaining({ p_operation_id: 'notification.preferences.v1' })
    );
    await expect(
      executeOperation(
        client,
        'notification.read.v1',
        {
          id: '10000000-0000-4000-8000-000000000001',
          expectedVersion: 0,
        },
        { idempotencyKey: 'notification-read-test-0001', surface: 'ui' }
      )
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      executeOperation(
        client,
        'notification.preferences.v1',
        {
          inAppEnabled: true,
          emailEnabled: true,
          emailHour: 24,
          quietHoursStart: '22:00',
          quietHoursEnd: '07:00',
        },
        { idempotencyKey: 'notification-preferences-test-0002', surface: 'ui' }
      )
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('exposes notification controls to MCP but keeps delivery private', () => {
    expect(mcpOperationIds).toEqual(
      expect.arrayContaining([
        'notification.refresh.v1',
        'notification.read.v1',
        'notification.dismiss.v1',
        'notification.preferences.v1',
      ])
    );
  });

  it('maps an undo conflict to a stable user-safe error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'undo_conflict' } });
    const client = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>;

    await expect(
      executeOperation(
        client,
        'operation.undo.v1',
        { receiptId: '30000000-0000-4000-8000-000000000001' },
        { idempotencyKey: 'operation-undo-0002', surface: 'ui' }
      )
    ).rejects.toMatchObject({ code: 'undo_conflict' } satisfies Partial<OperationFailure>);
  });

  it('maps an already-removed relation to a stable user-safe error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'relation_not_found' } });
    const client = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>;

    await expect(
      executeOperation(
        client,
        'note.goal-unlink.v1',
        {
          noteId: '10000000-0000-4000-8000-000000000001',
          goalId: '20000000-0000-4000-8000-000000000001',
        },
        { idempotencyKey: 'relation-unlink-0001', surface: 'ui' }
      )
    ).rejects.toMatchObject({ code: 'relation_not_found' } satisfies Partial<OperationFailure>);
  });
});
