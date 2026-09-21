import { describe, expect, it } from 'vitest';
import {
  completedByPeriodEnd,
  groupWeeklyItems,
  needsDecision,
  progressLabel,
  shiftWeek,
  weekBounds,
  weekQuarterLabel,
  weeklyProgress,
  type WeeklyItem,
} from '@/lib/planning/weekly-worksheet';

const week = { startsOn: '2026-02-02', endsOn: '2026-02-08' };

function item(overrides: Partial<WeeklyItem> & { actionId: string }): WeeklyItem {
  return {
    title: overrides.actionId,
    version: 1,
    status: 'open',
    scheduledOn: null,
    completedAt: null,
    areaId: null,
    areaName: null,
    inBaseline: true,
    disposition: null,
    ...overrides,
  };
}

describe('which week a date belongs to', () => {
  it('runs Monday to Sunday by default, and says so with both ends', () => {
    expect(weekBounds('2026-02-05')).toEqual(week);
  });

  it('follows the workspace preference rather than a constant', () => {
    // The same Sunday is the end of one person's week and the start of
    // another's, and both are right about their own plan.
    expect(weekBounds('2026-02-08', 1).startsOn).toBe('2026-02-02');
    expect(weekBounds('2026-02-08', 0).startsOn).toBe('2026-02-08');
  });

  it('steps backward and forward across a month boundary', () => {
    expect(shiftWeek(week, -1)).toEqual({ startsOn: '2026-01-26', endsOn: '2026-02-01' });
    expect(shiftWeek(week, 4)).toEqual({ startsOn: '2026-03-02', endsOn: '2026-03-08' });
  });

  it('keys a week crossing a quarter boundary on the day it starts', () => {
    // 29 June 2026 to 5 July: a week in two quarters. It belongs to the one it
    // began in, so the same week never appears under two labels.
    expect(weekQuarterLabel({ startsOn: '2026-06-29', endsOn: '2026-07-05' })).toBe('2026 Q2');
  });
});

describe('what counts as finished', () => {
  it('counts work finished on the final day of the period', () => {
    expect(
      completedByPeriodEnd(
        item({ actionId: 'a', status: 'done', completedAt: '2026-02-08T22:40:00.000Z' }),
        week
      )
    ).toBe(true);
  });

  it('does not count next week as last week', () => {
    // A review written on the Tuesday after must report the week it is about.
    expect(
      completedByPeriodEnd(
        item({ actionId: 'a', status: 'done', completedAt: '2026-02-10T09:00:00.000Z' }),
        week
      )
    ).toBe(false);
  });

  it('does not count work that is merely marked done with no instant', () => {
    expect(completedByPeriodEnd(item({ actionId: 'a', status: 'done' }), week)).toBe(false);
  });
});

describe('planned tasks completed', () => {
  it('divides finished baseline work by the baseline, not by everything', () => {
    const progress = weeklyProgress(
      [
        item({ actionId: 'a', status: 'done', completedAt: '2026-02-03T10:00:00.000Z' }),
        item({ actionId: 'b' }),
        item({ actionId: 'c', inBaseline: false }),
        item({
          actionId: 'd',
          inBaseline: false,
          status: 'done',
          completedAt: '2026-02-04T10:00:00.000Z',
        }),
      ],
      week
    );
    expect(progress).toEqual({
      baselineCount: 2,
      completedCount: 1,
      lateAdditionCount: 2,
      percentage: 50,
    });
  });

  it('shows an em dash rather than a number when nothing was planned', () => {
    const progress = weeklyProgress([item({ actionId: 'a', inBaseline: false })], week);
    expect(progress.percentage).toBeNull();
    expect(progressLabel(progress)).toBe('—');
  });

  it('reads as a percentage when there is a denominator', () => {
    expect(progressLabel(weeklyProgress([item({ actionId: 'a' })], week))).toBe('0%');
  });
});

describe('reading the week', () => {
  const items = [
    item({ actionId: 'mon', scheduledOn: '2026-02-02' }),
    item({ actionId: 'wed', scheduledOn: '2026-02-04', areaId: 'health', areaName: 'Health' }),
    item({ actionId: 'someday' }),
  ];

  it('gives every day a group so an empty Thursday is visibly empty', () => {
    const groups = groupWeeklyItems(items, week, 'day');
    expect(groups.slice(0, 7).map((group) => group.key)).toEqual([
      '2026-02-02',
      '2026-02-03',
      '2026-02-04',
      '2026-02-05',
      '2026-02-06',
      '2026-02-07',
      '2026-02-08',
    ]);
  });

  it('keeps work with no day chosen rather than dropping it', () => {
    const groups = groupWeeklyItems(items, week, 'day');
    const unscheduled = groups.at(-1);
    expect(unscheduled?.label).toBe('No day chosen');
    expect(unscheduled?.items.map((entry) => entry.actionId)).toEqual(['someday']);
  });

  it('groups by area with the unfiled work last', () => {
    const groups = groupWeeklyItems(items, week, 'area');
    expect(groups.map((group) => group.label)).toEqual(['Health', 'No area']);
  });
});

describe('what the review still has to decide', () => {
  it('asks about committed work that neither finished nor was decided', () => {
    const open = needsDecision(
      [
        item({ actionId: 'a', status: 'done', completedAt: '2026-02-03T10:00:00.000Z' }),
        item({ actionId: 'b' }),
        item({ actionId: 'c', disposition: 'moved' }),
        item({ actionId: 'd', inBaseline: false }),
      ],
      week
    );
    expect(open.map((entry) => entry.actionId)).toEqual(['b']);
  });
});
