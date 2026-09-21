/* Which Goals a period contains, and which ones outlast it.
 *
 * A Goal used to belong to exactly one dated period, because the row carried a
 * horizon and the horizon was one quarter or one year. An outcome running from
 * October into March had to be two Goals. Here a period is a question asked of
 * a Goal's own dates -- does this span overlap that one -- so the same Goal
 * answers yes for Q4 and yes for Q1, and the view says where it continues to
 * rather than pretending it ends on the 31st.
 *
 * Dates are ISO `YYYY-MM-DD` strings and compared as strings, which is correct
 * for that format and avoids inventing a timezone the caller did not give.
 */

export type PeriodKind = 'year' | 'quarter';

export type Period = {
  kind: PeriodKind;
  startsOn: string;
  endsOn: string;
  label: string;
};

export type GoalRecord = {
  id: string;
  title: string;
  status: 'draft' | 'active' | 'paused' | 'achieved' | 'abandoned';
  kind: 'outcome' | 'initiative';
  parentGoalId: string | null;
  primaryAreaId: string | null;
  /** Carried so a row on screen can be edited without a second read. */
  version: number;
  /** The Goal's own span. Either end may be missing. */
  startsOn: string | null;
  dueOn: string | null;
  /** The period it was filed under before Goals carried dates, if any. */
  horizonStartsOn: string | null;
  horizonEndsOn: string | null;
};

export type PeriodGoal = GoalRecord & {
  /** True when the Goal's work started before this period did. */
  startedEarlier: boolean;
  /** True when it is still running when this period ends. */
  continuesAfter: boolean;
  children: PeriodGoal[];
};

export type PeriodGroups = {
  period: Period;
  /** Outcomes that overlap the period, children nested under their parent. */
  scheduled: PeriodGoal[];
  /** Standing concerns. They have no dates and belong to no period. */
  initiatives: GoalRecord[];
  /** Real work with no decided dates. Not "in every period" -- in none. */
  unscheduled: GoalRecord[];
};

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The period of `kind` that contains `anchor`, an ISO date. */
export function periodContaining(kind: PeriodKind, anchor: string): Period {
  const year = Number(anchor.slice(0, 4));
  const month = Number(anchor.slice(5, 7));
  if (kind === 'year') {
    return {
      kind,
      startsOn: `${year}-01-01`,
      endsOn: `${year}-12-31`,
      label: String(year),
    };
  }
  const quarter = Math.floor((month - 1) / 3) + 1;
  const firstMonth = (quarter - 1) * 3 + 1;
  const lastMonth = firstMonth + 2;
  return {
    kind,
    startsOn: `${year}-${pad(firstMonth)}-01`,
    endsOn: `${year}-${pad(lastMonth)}-${pad(lastDayOfMonth(year, lastMonth))}`,
    label: `Q${quarter} ${year}`,
  };
}

/** The same period one step earlier or later. */
export function shiftPeriod(period: Period, steps: number): Period {
  const year = Number(period.startsOn.slice(0, 4));
  const month = Number(period.startsOn.slice(5, 7));
  if (period.kind === 'year') return periodContaining('year', `${year + steps}-01-01`);
  const quarterIndex = year * 4 + Math.floor((month - 1) / 3) + steps;
  const shiftedYear = Math.floor(quarterIndex / 4);
  const firstMonth = (quarterIndex - shiftedYear * 4) * 3 + 1;
  return periodContaining('quarter', `${shiftedYear}-${pad(firstMonth)}-01`);
}

/** The span a Goal occupies, from its own dates or the horizon it was filed under. */
export function goalSpan(goal: GoalRecord): { startsOn: string; endsOn: string } | null {
  const ownStart = goal.startsOn ?? goal.dueOn;
  const ownEnd = goal.dueOn ?? goal.startsOn;
  if (ownStart && ownEnd) return { startsOn: ownStart, endsOn: ownEnd };
  if (goal.horizonStartsOn && goal.horizonEndsOn) {
    return { startsOn: goal.horizonStartsOn, endsOn: goal.horizonEndsOn };
  }
  return null;
}

export function goalOverlapsPeriod(goal: GoalRecord, period: Period): boolean {
  const span = goalSpan(goal);
  if (!span) return false;
  return span.startsOn <= period.endsOn && span.endsOn >= period.startsOn;
}

/**
 * Group Goals for one period.
 *
 * `areaScope`, when given, keeps only Goals filed under one of those areas.
 * Being filed under a part of life does not schedule work, so an unscheduled
 * Goal stays unscheduled however it is filed.
 */
export function goalPeriodGroups(
  goals: readonly GoalRecord[],
  period: Period,
  options: { areaScope?: ReadonlySet<string> } = {}
): PeriodGroups {
  const { areaScope } = options;
  const inScope = areaScope
    ? goals.filter((goal) => goal.primaryAreaId !== null && areaScope.has(goal.primaryAreaId))
    : goals;

  const initiatives = inScope.filter((goal) => goal.kind === 'initiative');
  const outcomes = inScope.filter((goal) => goal.kind === 'outcome');
  const unscheduled = outcomes.filter((goal) => goalSpan(goal) === null);
  const overlapping = outcomes.filter((goal) => goalOverlapsPeriod(goal, period));

  const byId = new Map(overlapping.map((goal) => [goal.id, goal]));
  const decorate = (goal: GoalRecord): PeriodGoal => {
    const span = goalSpan(goal);
    return {
      ...goal,
      startedEarlier: span !== null && span.startsOn < period.startsOn,
      continuesAfter: span !== null && span.endsOn > period.endsOn,
      children: [],
    };
  };
  const nodes = new Map(overlapping.map((goal) => [goal.id, decorate(goal)]));
  const roots: PeriodGoal[] = [];
  for (const goal of overlapping) {
    const node = nodes.get(goal.id) as PeriodGoal;
    /* A child whose parent does not overlap this period is shown at the top
       level rather than hidden: the work is in the period even when the
       outcome above it is not. */
    const parent = goal.parentGoalId ? nodes.get(goal.parentGoalId) : undefined;
    if (parent && byId.has(goal.parentGoalId as string)) parent.children.push(node);
    else roots.push(node);
  }

  const byDate = (left: GoalRecord, right: GoalRecord) => {
    const leftSpan = goalSpan(left);
    const rightSpan = goalSpan(right);
    const start = (leftSpan?.startsOn ?? '').localeCompare(rightSpan?.startsOn ?? '');
    return start !== 0 ? start : left.title.localeCompare(right.title);
  };
  const sortTree = (list: PeriodGoal[]) => {
    list.sort(byDate);
    for (const node of list) sortTree(node.children);
  };
  sortTree(roots);

  return {
    period,
    scheduled: roots,
    initiatives: [...initiatives].sort((left, right) => left.title.localeCompare(right.title)),
    unscheduled: [...unscheduled].sort((left, right) => left.title.localeCompare(right.title)),
  };
}

/** How a Goal's span reads on screen when it does not fit the period. */
export function spanNote(goal: PeriodGoal): string | null {
  if (goal.startedEarlier && goal.continuesAfter) return 'Runs through this period';
  if (goal.startedEarlier) return 'Started earlier';
  if (goal.continuesAfter) return 'Continues after';
  return null;
}
