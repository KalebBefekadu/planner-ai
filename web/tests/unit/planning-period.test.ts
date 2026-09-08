import { describe, expect, it } from 'vitest';
import { overlapsPeriod, periodBounds } from '@/lib/planning-period';
import { plannerWeek, plannerWeekStart } from '@/lib/planner-calendar';

// A Planning Horizon is a time boundary, and the planner had been treating it
// as a category: filtering to "Week" returned every weekly Action ever
// created. These are the boundaries that make the filter mean the period a
// person is actually in -- including the ones people get wrong, which are all
// at the edges.

describe('the period a person is currently in', () => {
  it('bounds the year, quarter and month containing a date', () => {
    expect(periodBounds('year', '2026-09-08')).toEqual({
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
    });
    expect(periodBounds('quarter', '2026-09-08')).toEqual({
      startsOn: '2026-07-01',
      endsOn: '2026-09-30',
    });
    expect(periodBounds('month', '2026-09-08')).toEqual({
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
  });

  it('ends February on the right day in a leap year and a common one', () => {
    expect(periodBounds('month', '2024-02-11').endsOn).toBe('2024-02-29');
    expect(periodBounds('month', '2026-02-11').endsOn).toBe('2026-02-28');
  });

  it('keeps the last day of each quarter inside its own quarter', () => {
    expect(periodBounds('quarter', '2026-03-31')).toEqual({
      startsOn: '2026-01-01',
      endsOn: '2026-03-31',
    });
    expect(periodBounds('quarter', '2026-12-31').startsOn).toBe('2026-10-01');
  });

  it('respects the stored week-start preference instead of assuming Monday', () => {
    // Sunday 2026-09-13. Whether that Sunday closes one week or opens the next
    // is a real disagreement between two people, and the workspace preference
    // is the answer for each of them.
    expect(periodBounds('week', '2026-09-13', 1)).toEqual({
      startsOn: '2026-09-07',
      endsOn: '2026-09-13',
    });
    expect(periodBounds('week', '2026-09-13', 0)).toEqual({
      startsOn: '2026-09-13',
      endsOn: '2026-09-19',
    });
  });

  it('crosses a year boundary without splitting the week', () => {
    // 2027-01-01 is a Friday, so a Monday week reaches back into 2026.
    expect(periodBounds('week', '2027-01-01', 1)).toEqual({
      startsOn: '2026-12-28',
      endsOn: '2027-01-03',
    });
  });

  it('defaults to a Monday week for callers that have no preference', () => {
    expect(plannerWeekStart('2026-09-13')).toBe('2026-09-07');
    expect(plannerWeek('2026-09-13')[0]).toBe('2026-09-07');
    expect(plannerWeek('2026-09-13', 0)[0]).toBe('2026-09-13');
  });
});

describe('deciding whether work belongs to the period on screen', () => {
  const week = periodBounds('week', '2026-09-08', 1);

  it('includes a horizon that overlaps the period at either edge', () => {
    expect(overlapsPeriod({ startsOn: '2026-09-01', endsOn: '2026-09-07' }, week)).toBe(true);
    expect(overlapsPeriod({ startsOn: '2026-09-13', endsOn: '2026-09-20' }, week)).toBe(true);
  });

  it('excludes a horizon that ends before or starts after the period', () => {
    expect(overlapsPeriod({ startsOn: '2026-08-24', endsOn: '2026-08-30' }, week)).toBe(false);
    expect(overlapsPeriod({ startsOn: '2026-09-14', endsOn: '2026-09-20' }, week)).toBe(false);
  });

  it('reports no overlap for work that never recorded a period', () => {
    // The caller keeps this work visible rather than filtering it away; what
    // matters here is that an absent horizon is not silently treated as a
    // match for whichever period happens to be on screen.
    expect(overlapsPeriod({ startsOn: null, endsOn: null }, week)).toBe(false);
  });
});
