import { addCalendarDays, plannerWeekStart } from '@/lib/planner-calendar';

// A Planning Horizon is a time boundary, and the planner was treating it as a
// category. Filtering to "Week" showed every weekly Action ever created, so
// "This week" was a label on a list that had nothing to do with this week.
//
// These bounds answer the only question that makes the horizon filter mean
// something: which period is the person in right now, in their own timezone
// and with their own week start.

export type HorizonKind = 'year' | 'quarter' | 'month' | 'week';

export type PeriodBounds = {
  startsOn: string;
  endsOn: string;
};

const MONTHS_IN_QUARTER = 3;

function dateOnly(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

/** The bounds of the `kind` period containing `localDate`. */
export function periodBounds(kind: HorizonKind, localDate: string, weekStartsOn = 1): PeriodBounds {
  const [year, month] = localDate.split('-').map(Number);
  const monthIndex = month - 1;

  if (kind === 'year') {
    return { startsOn: `${year}-01-01`, endsOn: `${year}-12-31` };
  }
  if (kind === 'quarter') {
    const first = Math.floor(monthIndex / MONTHS_IN_QUARTER) * MONTHS_IN_QUARTER;
    return {
      startsOn: dateOnly(year, first, 1),
      // Day zero of the following month is the last day of this one, which
      // avoids caring about month lengths or leap years.
      endsOn: dateOnly(year, first + MONTHS_IN_QUARTER, 0),
    };
  }
  if (kind === 'month') {
    return { startsOn: dateOnly(year, monthIndex, 1), endsOn: dateOnly(year, monthIndex + 1, 0) };
  }

  const startsOn = plannerWeekStart(localDate, weekStartsOn);
  return { startsOn, endsOn: addCalendarDays(startsOn, 6) };
}

/**
 * Whether a horizon overlaps the given period at all.
 *
 * Overlap rather than containment: a monthly Action whose horizon straddles a
 * quarter boundary is genuinely part of both quarters, and dropping it from
 * one of them would hide real work rather than filter it.
 */
export function overlapsPeriod(
  horizon: { startsOn: string | null; endsOn: string | null },
  period: PeriodBounds
) {
  if (!horizon.startsOn || !horizon.endsOn) return false;
  return horizon.startsOn <= period.endsOn && horizon.endsOn >= period.startsOn;
}
