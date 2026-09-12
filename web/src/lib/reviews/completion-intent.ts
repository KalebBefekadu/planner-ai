// Completing a review is idempotent per *submission*, not per period.
//
// Keying only on the period looked right: one completed review per period is a
// database invariant, so a second press of the button should replay the first
// result rather than collide with the unique index. But an undone review
// leaves its receipt behind, marked reversed, and a period-only key finds that
// receipt and replays a success for a review that no longer exists. Completing
// the week again after undoing it would appear to work and save nothing.
//
// The intent is what distinguishes "the same submission, sent twice" from "a
// second, deliberate submission". A transport retry carries the intent it
// started with. Undoing and completing again is a new intent.

const INTENT = /^[A-Za-z0-9-]{8,120}$/;

export class ReviewIntentError extends Error {}

export function reviewCompletionKey(kind: string, startsOn: string, intentId: string) {
  if (!INTENT.test(intentId)) {
    throw new ReviewIntentError('This review cannot be submitted safely. Reload and try again.');
  }
  return `${kind}-review:${startsOn}:${intentId}`;
}

/** A new intent, for a submission that is not a retry of an earlier one. */
export function newReviewIntent() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `review-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
