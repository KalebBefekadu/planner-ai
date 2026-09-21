/**
 * Which goals have had no recorded work for a while.
 *
 * Deliberately not an AI intent. Every input here is a date and a count, and
 * the product rule is that deterministic code does dates, counts and filtering
 * while the model does interpretation. Asking a model which goals are quiet
 * would mean it could be wrong about a fact the database already knows, and
 * being wrong about this particular fact reads as an accusation.
 *
 * The output is an observation and never a judgement. A goal being quiet is
 * evidence about what has been written down, not about a person's life: work
 * done and never recorded looks identical here to work not done, and the
 * wording at every call site has to leave room for that. Nothing is scored,
 * nothing is ranked against another part of life, and a goal the person has
 * already paused is not reported at all -- pausing was the decision, and
 * raising it again would be arguing with it.
 */

export type QuietGoalInput = {
  id: string;
  title: string;
  status: string;
  /** The most recent time any linked Action was created, changed or finished. */
  lastActivityAt: string | null;
  /** Whether any linked Action is scheduled on or after today. */
  hasUpcomingWork: boolean;
};

export type QuietGoal = {
  id: string;
  title: string;
  /** Null when no linked work has ever been recorded against this goal. */
  lastActivityAt: string | null;
  quietForDays: number | null;
};

/** Two weeks. Long enough that an ordinary busy fortnight is not flagged. */
export const QUIET_AFTER_DAYS = 14;

/* A goal that is paused or closed is not quiet, it is decided. Draft and
   active are the two states where silence might be worth noticing. */
const WATCHED = new Set(['draft', 'active']);

function daysBetween(fromIso: string, toIso: string) {
  const from = Date.parse(fromIso);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.floor((to - from) / 86_400_000);
}

export function quietGoals(
  goals: readonly QuietGoalInput[],
  today: string,
  quietAfterDays: number = QUIET_AFTER_DAYS
): QuietGoal[] {
  return (
    goals
      .filter((goal) => WATCHED.has(goal.status))
      /* Work already on the calendar is not silence. A goal with next Tuesday
       booked against it is being attended to, whatever the last few weeks
       looked like. */
      .filter((goal) => !goal.hasUpcomingWork)
      .map((goal) => ({
        id: goal.id,
        title: goal.title,
        lastActivityAt: goal.lastActivityAt,
        quietForDays: goal.lastActivityAt ? daysBetween(goal.lastActivityAt, today) : null,
      }))
      .filter((goal) => goal.quietForDays === null || goal.quietForDays >= quietAfterDays)
      /* Longest silence first, and a goal that never had any work last: it has
       not gone quiet, it has not started, which is a different conversation. */
      .sort((left, right) => {
        if (left.quietForDays === null) return 1;
        if (right.quietForDays === null) return -1;
        return right.quietForDays - left.quietForDays;
      })
  );
}
