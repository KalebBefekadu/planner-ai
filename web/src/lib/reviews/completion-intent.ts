import { createHash } from 'node:crypto';

// A review completion is idempotent on the *submission*, not on the period.
//
// Keying purely on the period made the receipt outlive the review it recorded.
// Undo deletes the review row but deliberately keeps the original receipt --
// history is not rewritten -- so the next completion of that period presented
// the same key, matched that receipt, and was answered "saved" while nothing
// had been written. An edited reflection reused the key too, so a changed
// submission could be answered with the recorded result of an older one.
//
// The key has three parts.
//
//   period      -- which review this is, as before.
//   generation  -- how many completions of this period have been undone.
//                  Receipt keys are unique per workspace and Operation, so a
//                  completion after an undo cannot reuse the key of the
//                  receipt it is replacing; each undo opens a fresh one.
//   fingerprint -- exactly what is being submitted, so an edited reflection or
//                  a changed decision is a different intent.
//
// An unchanged transport retry -- a double click, a dropped connection --
// reproduces all three and replays the one durable result. Anything a person
// actually changed, and anything submitted after an undo, is attempted for
// real. No receipt is mutated or cleared.

export type ReviewIntentDecision = {
  actionId: string;
  expectedVersion: number;
  resolution: string;
  reason: string | null;
  priority: boolean;
};

function fingerprint(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

// The prefixes a period's completion receipts share, whichever generation and
// submission they belong to. Used to count the undone ones.
export function weeklyReviewKeyPrefix(startsOn: string): string {
  return `weekly-review:${startsOn}:`;
}

export function periodReviewKeyPrefix(kind: 'monthly' | 'quarterly', startsOn: string): string {
  return `${kind}-review:${startsOn}:`;
}

export function weeklyReviewIntentKey(
  input: {
    startsOn: string;
    endsOn: string;
    reflectionMarkdown: string;
    decisions: ReviewIntentDecision[];
  },
  generation: number
): string {
  // Decisions are sorted so that the same set of decisions in a different
  // render order stays one intent rather than becoming a second submission.
  const decisions = [...input.decisions]
    .sort((left, right) => left.actionId.localeCompare(right.actionId))
    .map((decision) => [
      decision.actionId,
      decision.expectedVersion,
      decision.resolution,
      decision.reason ?? '',
      decision.priority === true,
    ]);
  return `${weeklyReviewKeyPrefix(input.startsOn)}${generation}:${fingerprint([
    input.startsOn,
    input.endsOn,
    input.reflectionMarkdown,
    decisions,
  ])}`;
}

export function periodReviewIntentKey(
  input: {
    kind: 'monthly' | 'quarterly';
    startsOn: string;
    endsOn: string;
    reflectionMarkdown: string;
  },
  generation: number
): string {
  return `${periodReviewKeyPrefix(input.kind, input.startsOn)}${generation}:${fingerprint([
    input.kind,
    input.startsOn,
    input.endsOn,
    input.reflectionMarkdown,
  ])}`;
}
