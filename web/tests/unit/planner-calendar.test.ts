import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  isDateInPlannerWeek,
  plannerWeek,
  plannerWeekStart,
} from '@/lib/planner-calendar';

describe('Planner calendar date helpers', () => {
  it('builds a Monday-first week without local timezone drift', () => {
    expect(plannerWeekStart('2026-08-25')).toBe('2026-08-24');
    expect(plannerWeek('2026-08-25')).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ]);
  });

  it('crosses month and year boundaries', () => {
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('classifies only scheduled dates inside the selected week', () => {
    expect(isDateInPlannerWeek('2026-08-24', '2026-08-24')).toBe(true);
    expect(isDateInPlannerWeek('2026-08-30', '2026-08-24')).toBe(true);
    expect(isDateInPlannerWeek('2026-08-31', '2026-08-24')).toBe(false);
    expect(isDateInPlannerWeek(null, '2026-08-24')).toBe(false);
  });

  it('rejects invalid date-only input', () => {
    expect(() => plannerWeek('2026-02-30')).toThrow('valid calendar date');
    expect(() => plannerWeek('08/25/2026')).toThrow('YYYY-MM-DD');
  });
});
