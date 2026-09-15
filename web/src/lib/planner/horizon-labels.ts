// How a horizon and its period are named on screen.
//
// Small, but every one of these is a claim a reader acts on, and the date
// handling has a trap in it: a period bound is a calendar date with no time,
// and reading one as a timestamp puts it near midnight UTC, where any timezone
// west of it lands on the day before. Anchoring at noon keeps the label on the
// day the database actually named, everywhere.

import type { HorizonKind } from '@/lib/planning-period';

// The horizons a plan is filed into, widest first. This is a domain fact, not
// a detail of the Server Action that happens to return them, so it lives here
// and `@/app/actions` re-exports it for the callers that already had it.
export type GoalType = 'yearly' | 'quarterly' | 'monthly' | 'weekly';

export type PeriodBounds = { startsOn: string; endsOn: string };
export type HorizonFilter = 'all' | GoalType;

export const horizonKinds: Record<GoalType, HorizonKind> = {
  yearly: 'year',
  quarterly: 'quarter',
  monthly: 'month',
  weekly: 'week',
};

export const horizonLabels: Record<GoalType, string> = {
  yearly: 'Yearly goal',
  quarterly: 'Quarterly goal',
  monthly: 'Monthly action',
  weekly: 'Weekly action',
};

// What a horizon breaks down into. Weekly is absent because a weekly action is
// the smallest thing the planner files; it breaks down into doing it.
export const childHorizonTypes: Partial<Record<GoalType, GoalType>> = {
  yearly: 'quarterly',
  quarterly: 'monthly',
  monthly: 'weekly',
};

export function readableRange(bounds: PeriodBounds) {
  const format = (value: string) =>
    new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${value}T12:00:00Z`));
  return `${format(bounds.startsOn)} - ${format(bounds.endsOn)}`;
}

export function periodRangeLabel(
  horizon: HorizonFilter,
  periods: Record<HorizonKind, PeriodBounds>
) {
  if (horizon === 'all') {
    // With every horizon shown, each row is scoped to its own period, so
    // naming one range would be wrong for three quarters of the list.
    return 'Each horizon scoped to its current period';
  }
  return readableRange(periods[horizonKinds[horizon]]);
}
