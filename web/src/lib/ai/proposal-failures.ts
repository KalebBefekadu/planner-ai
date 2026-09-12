/* Approving a Proposal, dismissing one, and undoing an applied one all fail in
   two fundamentally different ways, and the difference decides what the person
   should do next.

   A provider outage or a dropped connection is worth another press of Approve:
   the Proposal is still pending in the database and the retry is idempotent.
   But a Proposal that has already been applied, already been dismissed, or
   whose target record has moved on since Planner AI proposed the change can
   never be approved again, no matter how many times the button is pressed.

   Both used to arrive in the dock as the same anonymous "AI assistance could
   not complete this request", and the dock puts the Proposal card back after
   any failure, so the second kind turned one impossible approval into an
   endless offer to repeat it. Classifying the failure is what lets the dock
   stop offering an action that cannot succeed, and lets the message say what
   actually happened to the change. */

export type AssistantDecisionKind = 'approval' | 'dismissal' | 'undo';

export type AssistantDecisionProblem = {
  status: number;
  code: string;
  message: string;
};

/* Failures a retry cannot fix. The dock reads this to decide whether to give
   the Proposal or the Undo button back. */
const PERMANENT_CODES = new Set(['proposal_not_actionable', 'assistant_change_stale']);

export function isPermanentAssistantFailure(code: string | null | undefined) {
  return typeof code === 'string' && PERMANENT_CODES.has(code);
}

function failureText(error: unknown) {
  if (!error || typeof error !== 'object') return '';
  const candidate = error as { message?: unknown; code?: unknown; details?: unknown };
  return [candidate.message, candidate.code, candidate.details]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
}

/* The proposal is gone as an actionable thing: applied, dismissed, deleted,
   owned by somebody else, or attached to a Conversation that is no longer
   active. The database refuses all of these identically and on purpose, so
   that a caller cannot tell an absent Proposal from another owner's. The reply
   keeps that boundary and still tells the person the one thing they need: no
   change was made, and this card is spent. */
const NOT_ACTIONABLE: Record<AssistantDecisionKind, string> = {
  approval:
    'That suggestion is no longer available to approve, and nothing was changed. Ask Planner AI again to get a fresh one.',
  dismissal: 'That suggestion is already gone, and nothing was changed.',
  undo: 'That change has already been undone, or it is too late to undo it. Nothing was changed.',
};

const STALE: Record<AssistantDecisionKind, string> = {
  approval:
    'The record changed after Planner AI suggested this, so nothing was changed. Ask Planner AI again for an up-to-date suggestion.',
  dismissal: 'That suggestion is already gone, and nothing was changed.',
  undo: 'The record changed after this was applied, so it can no longer be undone. Nothing was changed.',
};

export function assistantDecisionProblem(
  error: unknown,
  kind: AssistantDecisionKind
): AssistantDecisionProblem | null {
  const text = failureText(error);

  if (text.includes('proposal_not_found') || text.includes('undo_not_available')) {
    /* 410 rather than 409: the thing being acted on is gone, and 409 already
       carries a different meaning on this route, where it marks a successful
       reply that declines to act under the legacy data model. */
    return { status: 410, code: 'proposal_not_actionable', message: NOT_ACTIONABLE[kind] };
  }
  if (
    text.includes('version_conflict_or_not_found') ||
    text.includes('version_conflict') ||
    text.includes('undo_conflict')
  ) {
    return { status: 409, code: 'assistant_change_stale', message: STALE[kind] };
  }
  if (text.includes('authentication_required')) {
    return {
      status: 401,
      code: 'authentication_required',
      message: 'Please sign in again. Nothing was changed.',
    };
  }
  return null;
}
