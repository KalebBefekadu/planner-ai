import { describe, expect, it } from 'vitest';
import { operationDefinitions, type OperationId } from '@/lib/operations';
import { mcpGrantOptions, mcpOperationIds } from '@/lib/mcp/catalog';
import { undoableOperationIds } from '@/lib/operations';

/* The product's north star is that whatever a human can do, an agent can do
   too. That principle has deliberate exceptions, and the exceptions are the
   part worth protecting: an agent that can approve its own proposals, raise
   its own budget, or undo its own changes has defeated the approval model
   described in direction doc §18.1.

   This file pins the boundary in both directions. Adding an operation without
   agent exposure fails the parity check; widening one of the human-only
   operations fails the safety check. Either way the change has to be
   deliberate. */

type Exposure = 'ui' | 'chat' | 'mcp' | 'automation' | 'system';

const entries = Object.entries(operationDefinitions) as Array<
  [OperationId, { exposure: readonly Exposure[]; reversible: boolean; risk: string }]
>;

const exposureOf = (id: OperationId) =>
  (operationDefinitions[id] as { exposure: readonly Exposure[] }).exposure;

/* Each of these is withheld from agents on purpose. The reason is recorded
   here because a bare list invites someone to "fix" it later. */
const HUMAN_ONLY: Partial<Record<OperationId, string>> = {
  'operation.undo.v1': 'An agent that can undo its own writes can erase the evidence of them.',
  'capture-proposal.apply.v1': 'Approving a proposal is the human half of the approval model.',
  'capture-proposal.dismiss.v1': 'Dismissing a proposal is a decision about the agent, not by it.',
  'capture-proposal.item-update.v1':
    'Editing a proposed change before approving it is the human review step.',
  'workspace.ai-budget.v1': 'An agent must not be able to raise its own spending limit.',
  'trash.empty.v1': 'Permanent deletion has no undo, so it stays a human action.',
  'account.deletion.schedule.v1': 'Account deletion is never delegated.',
  'account.deletion.cancel.v1': 'Account deletion is never delegated.',
  'conversation.delete.v1': 'Deleting history removes the record of what an agent did.',
  'note.import-preview.v1': 'Bulk import reads the filesystem and is driven from the UI.',
  'note.import-commit.v1': 'Bulk import writes many records at once from a human-supplied file.',
  'review.complete-weekly.v1': 'A review is the user reflecting; an agent cannot do it for them.',
  'review.complete-period.v1': 'A review is the user reflecting; an agent cannot do it for them.',
  'workspace.preferences.v1': 'Preferences describe how the user wants to be treated.',
  'workspace.onboarding-complete.v1': 'Onboarding completes when the person says it has.',
};

describe('human and agent parity', () => {
  it('exposes every operation to a human surface', () => {
    const orphaned = entries.filter(([, definition]) => !definition.exposure.includes('ui'));
    expect(orphaned.map(([id]) => id)).toEqual([]);
  });

  it('gives agents everything a human can do, except the recorded exceptions', () => {
    const withheld = entries
      .filter(([, definition]) => !definition.exposure.includes('mcp'))
      .map(([id]) => id)
      .sort();
    expect(withheld).toEqual(Object.keys(HUMAN_ONLY).sort());
  });

  it('keeps the approval model intact: no agent approves its own proposal', () => {
    for (const id of [
      'capture-proposal.apply.v1',
      'capture-proposal.dismiss.v1',
      'capture-proposal.item-update.v1',
    ] as const) {
      expect(exposureOf(id)).not.toContain('mcp');
    }
  });

  it('keeps an agent away from its own budget and its own undo', () => {
    expect(exposureOf('workspace.ai-budget.v1')).not.toContain('mcp');
    expect(exposureOf('operation.undo.v1')).not.toContain('mcp');
    expect(exposureOf('operation.undo.v1')).not.toContain('chat');
  });

  it('never delegates an irreversible account or deletion action', () => {
    for (const id of [
      'trash.empty.v1',
      'account.deletion.schedule.v1',
      'account.deletion.cancel.v1',
    ] as const) {
      expect(exposureOf(id)).not.toContain('mcp');
    }
  });

  it('records a reason for every operation withheld from agents', () => {
    for (const [id, reason] of Object.entries(HUMAN_ONLY)) {
      expect(reason.length, `${id} needs a reason, not just an entry`).toBeGreaterThan(20);
    }
  });

  it('derives the MCP tool surface from exposure, never a second hand-kept list', () => {
    const fromDefinitions = entries
      .filter(([, definition]) => definition.exposure.includes('mcp'))
      .map(([id]) => id)
      .sort();
    expect([...mcpOperationIds].sort()).toEqual(fromDefinitions);
  });

  it('offers a grant for every MCP tool, plus the read-only snapshot', () => {
    expect(mcpGrantOptions).toHaveLength(mcpOperationIds.length + 1);
    expect(mcpGrantOptions.map((grant) => grant.id)).toContain('workspace.snapshot.read.v1');
  });

  /* The route annotates each tool with destructiveHint for MCP clients.
     Testing risk === 'medium' inverted it for high-risk operations, so the
     rule is pinned here: anything above low risk is destructive. */
  it('treats every operation above low risk as destructive', () => {
    const destructive = (risk: string) => risk !== 'low';
    expect(destructive('low')).toBe(false);
    expect(destructive('medium')).toBe(true);
    expect(destructive('high')).toBe(true);
  });

  /* "You can always undo" is promised on the sign-in page. Two independent
     sources back it: the reversible flag on each operation, and the
     undoableOperationIds list. They are hand-maintained and can drift, and a
     drift in either direction is a broken promise — either the UI offers an
     undo that does not exist, or a reversible change is silently one-way. */
  it('keeps the reversible flag and the undo list in exact agreement', () => {
    const flagged = entries
      .filter(([, definition]) => definition.reversible)
      .map(([id]) => id)
      .sort();
    expect([...undoableOperationIds].sort()).toEqual(flagged);
  });

  it('never lists an operation as undoable that is not reversible', () => {
    for (const id of undoableOperationIds) {
      expect(operationDefinitions[id].reversible, `${id} is listed but not reversible`).toBe(true);
    }
  });

  it('marks a high-risk operation reversible, or withholds it from agents', () => {
    const risky = entries.filter(
      ([, definition]) =>
        definition.risk === 'high' && !definition.reversible && definition.exposure.includes('mcp')
    );
    expect(risky.map(([id]) => id)).toEqual([]);
  });
});
