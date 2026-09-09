import { describe, expect, it } from 'vitest';
import { assistantDecisionProblem, isPermanentAssistantFailure } from '@/lib/ai/proposal-failures';

/* The value of this classification is entirely in what the person does next.
   A retryable failure leaves the Proposal on screen; a permanent one takes it
   away and explains why. Getting that backwards is what produced the endless
   approval loop, so both directions are pinned here. */
describe('assistant decision failures', () => {
  it('treats an already-decided Proposal as gone rather than retryable', () => {
    const problem = assistantDecisionProblem({ message: 'proposal_not_found' }, 'approval');
    expect(problem?.code).toBe('proposal_not_actionable');
    expect(problem?.status).toBe(410);
    expect(isPermanentAssistantFailure(problem?.code)).toBe(true);
  });

  /* The database refuses an absent Proposal and another owner's Proposal with
     the same error on purpose. The reply must not become a way to tell them
     apart, so the message names neither the Proposal nor its owner. */
  it('does not let the failure reveal whether the Proposal belonged to someone else', () => {
    const problem = assistantDecisionProblem({ message: 'proposal_not_found' }, 'approval');
    expect(problem?.message).not.toMatch(/owner|permission|another|forbidden/i);
  });

  it('says plainly that nothing changed, for every kind of decision', () => {
    for (const kind of ['approval', 'dismissal', 'undo'] as const) {
      for (const message of ['proposal_not_found', 'version_conflict_or_not_found']) {
        const problem = assistantDecisionProblem({ message }, kind);
        expect(problem?.message, `${kind}/${message}`).toMatch(/nothing was changed/i);
      }
    }
  });

  /* A Proposal carries the version it was written against. When the record has
     moved on, approving it again can only fail the same way, so this counts as
     permanent even though nothing is missing. */
  it('treats a record that moved on since the Proposal as permanent, not retryable', () => {
    const problem = assistantDecisionProblem(
      { message: 'version_conflict_or_not_found' },
      'approval'
    );
    expect(problem?.code).toBe('assistant_change_stale');
    expect(problem?.status).toBe(409);
    expect(isPermanentAssistantFailure(problem?.code)).toBe(true);
    expect(problem?.message).toMatch(/ask planner ai again/i);
  });

  it('recognises an undo that has already run or expired', () => {
    expect(assistantDecisionProblem({ message: 'undo_not_available' }, 'undo')?.code).toBe(
      'proposal_not_actionable'
    );
    expect(assistantDecisionProblem({ message: 'undo_conflict' }, 'undo')?.code).toBe(
      'assistant_change_stale'
    );
  });

  /* A Supabase error puts the database message on `message`, while an
     OperationFailure carries its reason on `code`. Both reach this route. */
  it('reads the reason whether it arrives as a message or as a code', () => {
    expect(assistantDecisionProblem({ code: 'version_conflict' }, 'undo')?.code).toBe(
      'assistant_change_stale'
    );
  });

  /* An outage has no recognisable reason, and must stay retryable: the
     Proposal is still pending in the database and one more press applies it. */
  it('leaves an unrecognised failure retryable so an outage costs only a retry', () => {
    expect(assistantDecisionProblem(new Error('fetch failed'), 'approval')).toBeNull();
    expect(assistantDecisionProblem(undefined, 'approval')).toBeNull();
    expect(isPermanentAssistantFailure(null)).toBe(false);
    expect(isPermanentAssistantFailure('provider_unavailable')).toBe(false);
  });
});
