import { describe, expect, it } from 'vitest';
import {
  childHorizonTypes,
  horizonKinds,
  horizonLabels,
  periodRangeLabel,
  plannerHeading,
  readableRange,
} from '@/lib/planner/horizon-labels';

const periods = {
  year: { startsOn: '2026-01-01', endsOn: '2026-12-31' },
  quarter: { startsOn: '2026-07-01', endsOn: '2026-09-30' },
  month: { startsOn: '2026-09-01', endsOn: '2026-09-30' },
  week: { startsOn: '2026-09-14', endsOn: '2026-09-20' },
};

describe('reading a period range', () => {
  it('names both ends of the week', () => {
    expect(readableRange(periods.week)).toBe('Sep 14 - Sep 20');
  });

  /* A period bound is a calendar date with no time. Reading one as a timestamp
     puts it at midnight UTC, and every timezone west of UTC then renders the
     day before -- so a week starting Sunday the 14th is labelled as starting
     Saturday the 13th for most of the Americas. Anchoring at noon is what
     keeps the label on the day the database named. */
  it('keeps the named day in a timezone behind UTC', () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(readableRange(periods.week)).toBe('Sep 14 - Sep 20');
    } finally {
      process.env.TZ = previousTz;
    }
  });

  it('keeps the named day in a timezone ahead of UTC', () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';
    try {
      expect(readableRange(periods.week)).toBe('Sep 14 - Sep 20');
    } finally {
      process.env.TZ = previousTz;
    }
  });

  it('spans a year end without renaming either month', () => {
    expect(readableRange(periods.year)).toBe('Jan 1 - Dec 31');
  });
});

describe('labelling the period a list is scoped to', () => {
  it('names the range of the horizon being shown', () => {
    expect(periodRangeLabel('weekly', periods)).toBe('Sep 14 - Sep 20');
    expect(periodRangeLabel('quarterly', periods)).toBe('Jul 1 - Sep 30');
  });

  /* With every horizon shown, each row is scoped to its own period, so naming
     one range would be wrong for three quarters of the list. */
  it('names no range at all when every horizon is shown', () => {
    expect(periodRangeLabel('all', periods)).toBe('Each horizon scoped to its current period');
  });
});

describe('the horizon ladder', () => {
  it('maps every goal type to the period kind it is filed in', () => {
    expect(horizonKinds).toEqual({
      yearly: 'year',
      quarterly: 'quarter',
      monthly: 'month',
      weekly: 'week',
    });
  });

  it('gives every horizon a name a person would recognise', () => {
    expect(Object.values(horizonLabels)).toEqual([
      'Yearly goal',
      'Quarterly goal',
      'Monthly action',
      'Weekly action',
    ]);
  });

  it('breaks each horizon down into exactly the one below it', () => {
    expect(childHorizonTypes.yearly).toBe('quarterly');
    expect(childHorizonTypes.quarterly).toBe('monthly');
    expect(childHorizonTypes.monthly).toBe('weekly');
  });

  /* A weekly action is the smallest thing the planner files. It breaks down
     into doing it, so offering an "Add" beneath one would promise a horizon
     that does not exist. */
  it('offers nothing beneath a weekly action', () => {
    expect(childHorizonTypes.weekly).toBeUndefined();
  });
});

describe('what the planner page is called', () => {
  /* One heading for every combination of two filters told the reader nothing
     about which of the eight slices they were looking at. */
  it('names the slice on screen rather than the product', () => {
    expect(plannerHeading('weekly', 'current')).toBe('This week');
    expect(plannerHeading('quarterly', 'current')).toBe('This quarter');
    expect(plannerHeading('yearly', 'current')).toBe('This year');
    expect(plannerHeading('monthly', 'current')).toBe('This month');
  });

  it('says so when the period filter has been taken off', () => {
    expect(plannerHeading('weekly', 'all')).toBe('Every week on record');
    expect(plannerHeading('all', 'all')).toBe('Your whole plan');
  });

  it('has a name for every combination the two filters can make', () => {
    for (const horizon of ['all', 'yearly', 'quarterly', 'monthly', 'weekly'] as const) {
      for (const period of ['current', 'all'] as const) {
        expect(plannerHeading(horizon, period), `${horizon}/${period}`).toBeTruthy();
      }
    }
  });
});
