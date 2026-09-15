/**
 * A checkpoint is one completed Weekly Review. How many of them an Action has
 * outlived is the number this design rests on: it is the only fact that says
 * nobody is ever going to do this, and it is what makes carrying work forward
 * safe to leave silent.
 *
 * It is deliberately not derived from `action_schedule_history`. Those rows are
 * written once per submitted decision, so a Review that stops demanding a
 * decision on every item stops writing them -- the signal would be a byproduct
 * of the very cost this screen exists to remove. Counting checkpoints instead
 * makes the number a property of the week, correct retroactively, and unchanged
 * by whatever the person did or did not click.
 */

/** Two years of weeks. Older checkpoints cannot change any label on screen. */
export const WEEKLY_CHECKPOINT_WINDOW = 104;

/** A week that finished more than this is a data problem, not a busy week. */
export const FINISHED_LIST_LIMIT = 500;

/**
 * The point at which staying open stops being credible without a reason.
 * Three is small enough to argue with and matches the five-priority and
 * five-focus discipline already in the product.
 */
export const STALLED_AFTER_CHECKPOINTS = 3;

/**
 * How many of `checkpoints` happened after `createdAt`.
 *
 * `checkpoints` are ISO timestamps in any order; comparison is lexical, which
 * is exact for the ISO-8601 UTC strings Postgres returns.
 */
export function countCheckpointsSince(checkpoints: readonly string[], createdAt: string): number {
  let survived = 0;
  for (const checkpoint of checkpoints) {
    if (checkpoint > createdAt) survived += 1;
  }
  return survived;
}

export function isStalled(weeksCarried: number): boolean {
  return weeksCarried >= STALLED_AFTER_CHECKPOINTS;
}

const ORDINAL_SUFFIX = ['th', 'st', 'nd', 'rd'] as const;

function ordinal(value: number): string {
  const tens = value % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (ORDINAL_SUFFIX[value % 10] ?? 'th');
  return `${value}${suffix}`;
}

/**
 * What the age reads as on screen.
 *
 * An Action that has survived nothing is "new", not "1st week" -- it may have
 * been written an hour ago, and claiming a week it has not lived through is the
 * screen lying to itself. Everything else is stated as the week it is now in,
 * which is one more than the number of checkpoints behind it.
 */
export function carriedLabel(weeksCarried: number): string {
  if (weeksCarried <= 0) return 'new';
  return `${ordinal(weeksCarried + 1)} week`;
}

/**
 * Attaching a priority to a decision.
 *
 * The priority flag rides on a decision, and a row with no decision is left out
 * of the payload entirely -- so naming something a priority has to record a
 * decision too, or the flag is silently dropped on submit and next week gets
 * none of the five.
 *
 * This lives here rather than inline because there are two ways to set a
 * priority -- the checkbox on a row, and accepting the assistant's suggested
 * five -- and the first was updated for that rule while the second was not.
 */
export function withPriority<Decision extends { resolution: string; priority: boolean }>(
  decision: Decision,
  priority: boolean
): Decision {
  return {
    ...decision,
    priority,
    resolution: priority && decision.resolution === 'unset' ? 'keep' : decision.resolution,
  };
}

/** Priority is meaningless on work that is finished or abandoned. */
export function canPrioritize(resolution: string): boolean {
  return !['done', 'dropped'].includes(resolution);
}
