/* Drift detection: is a Goal actually on pace to meet its own measure?

   The /preview design surfaces this as "2 goals have drifted from their
   measure", and the direction doc's coaching stance is to surface drift rather
   than silently correct it — so this reports, and never changes anything.

   Everything here is derived from fields the Goal already carries
   (target_value, current_value, due_on, status). A Goal with no target has no
   measure to drift from, and that is itself worth saying: a goal you cannot
   check is the one most likely to quietly rot. */

export type PaceState =
  | 'done' // reached the target, or marked achieved
  | 'on-track' // at or ahead of where the calendar says it should be
  | 'at-risk' // behind pace, but the deadline has not passed
  | 'overdue' // past the deadline and not met
  | 'not-started' // has a measure, no progress recorded yet
  | 'no-measure' // no target value to judge against
  | 'no-deadline'; // has a target but no date, so pace is unknowable

export type PaceAssessment = {
  state: PaceState;
  /* Fraction of the target actually reached, 0-1, null when unmeasurable. */
  actual: number | null;
  /* Fraction the calendar says should be reached by now, 0-1, null when
     there is no deadline. */
  expected: number | null;
  /* Plain-language reason, written to be shown to the person directly. */
  reason: string;
  daysRemaining: number | null;
};

export type PaceGoal = {
  content: string;
  status: string;
  created_at: string;
  due_on?: string | null;
  target_value?: number | null;
  current_value?: number | null;
  unit?: string | null;
};

/* Being a little behind is normal and not worth interrupting someone over.
   Only a gap wider than this counts as drift. */
const TOLERANCE = 0.15;

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(value: string | Date) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function assessGoalPace(goal: PaceGoal, today: string | Date = new Date()): PaceAssessment {
  const now = startOfDay(today);
  const target = goal.target_value ?? null;
  const current = goal.current_value ?? 0;

  if (goal.status === 'achieved' || goal.status === 'completed' || goal.status === 'done') {
    return {
      state: 'done',
      actual: 1,
      expected: 1,
      reason: 'Met.',
      daysRemaining: null,
    };
  }

  if (target === null || target <= 0) {
    return {
      state: 'no-measure',
      actual: null,
      expected: null,
      reason: 'No measure set, so there is nothing to check this against.',
      daysRemaining: null,
    };
  }

  const actual = Math.min(current / target, 1);
  const unit = goal.unit ? ` ${goal.unit}` : '';
  const progress = `${current} of ${target}${unit}`;

  if (actual >= 1) {
    return {
      state: 'done',
      actual: 1,
      expected: null,
      reason: `Target reached — ${progress}.`,
      daysRemaining: null,
    };
  }

  if (!goal.due_on) {
    return {
      state: 'no-deadline',
      actual,
      expected: null,
      reason: `${progress}, with no date to measure pace against.`,
      daysRemaining: null,
    };
  }

  const due = startOfDay(goal.due_on);
  const started = Math.min(startOfDay(goal.created_at), due);
  const daysRemaining = Math.round((due - now) / DAY);

  if (now > due) {
    return {
      state: 'overdue',
      actual,
      expected: 1,
      reason: `Past its date by ${plural(Math.abs(daysRemaining), 'day')}, at ${progress}.`,
      daysRemaining,
    };
  }

  const span = due - started;
  /* A goal created on its own due date has no runway; treat it as fully due
     rather than dividing by zero. */
  const expected = span <= 0 ? 1 : Math.min(Math.max((now - started) / span, 0), 1);

  if (current <= 0) {
    return {
      state: 'not-started',
      actual: 0,
      expected,
      reason:
        daysRemaining === 0
          ? 'Nothing recorded, and it is due today.'
          : `Nothing recorded yet, with ${plural(daysRemaining, 'day')} left.`,
      daysRemaining,
    };
  }

  if (actual + TOLERANCE < expected) {
    const shortfall = Math.round((expected - actual) * 100);
    return {
      state: 'at-risk',
      actual,
      expected,
      reason: `${progress} — about ${shortfall}% behind the pace this date implies.`,
      daysRemaining,
    };
  }

  return {
    state: 'on-track',
    actual,
    expected,
    reason: `${progress}, on pace with ${plural(daysRemaining, 'day')} left.`,
    daysRemaining,
  };
}

const DRIFTING: ReadonlySet<PaceState> = new Set(['at-risk', 'overdue', 'not-started']);

export function isDrifting(assessment: PaceAssessment) {
  return DRIFTING.has(assessment.state);
}

/* The banner copy in the Goals design. Deliberately reports and stops — the
   coaching stance is to show drift, not to quietly fix it. */
export function summariseDrift(
  goals: readonly PaceGoal[],
  today: string | Date = new Date()
): { drifting: number; unmeasured: number; headline: string | null } {
  const assessments = goals.map((goal) => assessGoalPace(goal, today));
  const drifting = assessments.filter(isDrifting).length;
  const unmeasured = assessments.filter((a) => a.state === 'no-measure').length;

  if (drifting === 0 && unmeasured === 0) return { drifting, unmeasured, headline: null };

  if (drifting === 0) {
    return {
      drifting,
      unmeasured,
      headline: `${plural(unmeasured, 'goal')} ${unmeasured === 1 ? 'has' : 'have'} no measure to check against`,
    };
  }

  const tail = unmeasured > 0 ? `, and ${plural(unmeasured, 'goal')} cannot be checked` : '';
  const [verb, possessive] = drifting === 1 ? ['has', 'its'] : ['have', 'their'];
  return {
    drifting,
    unmeasured,
    headline: `${plural(drifting, 'goal')} ${verb} drifted from ${possessive} measure${tail}`,
  };
}
