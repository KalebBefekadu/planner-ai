import { describe, expect, it } from 'vitest';
import {
  goalOverlapsPeriod,
  goalPeriodGroups,
  goalSpan,
  periodContaining,
  shiftPeriod,
  spanNote,
  type GoalRecord,
} from '@/lib/planning/goal-periods';

function goal(id: string, overrides: Partial<GoalRecord> = {}): GoalRecord {
  return {
    id,
    title: id,
    status: 'active',
    kind: 'outcome',
    parentGoalId: null,
    primaryAreaId: null,
    version: 1,
    startsOn: null,
    dueOn: null,
    horizonStartsOn: null,
    horizonEndsOn: null,
    ...overrides,
  };
}

describe('naming a period', () => {
  it('reads a quarter off the month it contains', () => {
    expect(periodContaining('quarter', '2026-11-14')).toEqual({
      kind: 'quarter',
      startsOn: '2026-10-01',
      endsOn: '2026-12-31',
      label: 'Q4 2026',
    });
  });

  it('ends February on the day February actually ends', () => {
    expect(periodContaining('quarter', '2028-02-29').endsOn).toBe('2028-03-31');
    expect(periodContaining('quarter', '2026-01-05').endsOn).toBe('2026-03-31');
  });

  it('crosses the year boundary when stepping forward', () => {
    expect(shiftPeriod(periodContaining('quarter', '2026-11-14'), 1).label).toBe('Q1 2027');
    expect(shiftPeriod(periodContaining('quarter', '2026-02-01'), -1).label).toBe('Q4 2025');
    expect(shiftPeriod(periodContaining('year', '2026-06-01'), -1).label).toBe('2025');
  });
});

describe('the span a Goal occupies', () => {
  it('prefers the Goal to the horizon it was once filed under', () => {
    expect(
      goalSpan(
        goal('g', {
          startsOn: '2026-10-01',
          dueOn: '2027-03-31',
          horizonStartsOn: '2026-10-01',
          horizonEndsOn: '2026-12-31',
        })
      )
    ).toEqual({ startsOn: '2026-10-01', endsOn: '2027-03-31' });
  });

  it('reads a Goal written before Goals carried dates', () => {
    expect(
      goalSpan(goal('g', { horizonStartsOn: '2026-01-01', horizonEndsOn: '2026-12-31' }))
    ).toEqual({ startsOn: '2026-01-01', endsOn: '2026-12-31' });
  });

  it('treats one date as a point in time rather than an open end', () => {
    expect(goalSpan(goal('g', { dueOn: '2026-11-30' }))).toEqual({
      startsOn: '2026-11-30',
      endsOn: '2026-11-30',
    });
  });

  it('has no span when nothing says when', () => {
    expect(goalSpan(goal('g'))).toBeNull();
  });
});

describe('a Goal that outlasts its quarter', () => {
  const q4 = periodContaining('quarter', '2026-11-01');
  const q1 = periodContaining('quarter', '2027-02-01');
  const crossing = goal('rebuild', { startsOn: '2026-10-01', dueOn: '2027-03-31' });

  it('is the same Goal in both quarters, not two', () => {
    expect(goalOverlapsPeriod(crossing, q4)).toBe(true);
    expect(goalOverlapsPeriod(crossing, q1)).toBe(true);
  });

  it('says which edge it runs past', () => {
    const [inQ4] = goalPeriodGroups([crossing], q4).scheduled;
    const [inQ1] = goalPeriodGroups([crossing], q1).scheduled;
    expect(spanNote(inQ4)).toBe('Continues after');
    expect(spanNote(inQ1)).toBe('Started earlier');
    expect(
      spanNote(goalPeriodGroups([crossing], periodContaining('year', '2026-11-01')).scheduled[0])
    ).toBe('Continues after');
  });

  it('stays out of a quarter it does not reach', () => {
    expect(goalOverlapsPeriod(crossing, periodContaining('quarter', '2027-05-01'))).toBe(false);
  });
});

describe('grouping a period', () => {
  const q4 = periodContaining('quarter', '2026-11-01');
  const parent = goal('year', { startsOn: '2026-01-01', dueOn: '2026-12-31' });
  const child = goal('quarter', {
    startsOn: '2026-10-01',
    dueOn: '2026-12-31',
    parentGoalId: 'year',
  });
  const someday = goal('someday');
  const standing = goal('business', { kind: 'initiative' });

  it('nests work under the outcome it serves', () => {
    const groups = goalPeriodGroups([child, parent, someday, standing], q4);
    expect(groups.scheduled.map((node) => node.id)).toEqual(['year']);
    expect(groups.scheduled[0].children.map((node) => node.id)).toEqual(['quarter']);
  });

  it('keeps undated work out of every period and says where it went', () => {
    const groups = goalPeriodGroups([child, parent, someday, standing], q4);
    expect(groups.unscheduled.map((node) => node.id)).toEqual(['someday']);
    expect(groups.initiatives.map((node) => node.id)).toEqual(['business']);
    expect(goalPeriodGroups([someday], periodContaining('year', '2026-01-01')).scheduled).toEqual(
      []
    );
  });

  it('shows work whose parent is not in this period rather than hiding it', () => {
    const q1 = periodContaining('quarter', '2027-02-01');
    const orphaned = goal('q1-work', {
      startsOn: '2027-01-01',
      dueOn: '2027-03-31',
      parentGoalId: 'year',
    });
    const groups = goalPeriodGroups([parent, orphaned], q1);
    expect(groups.scheduled.map((node) => node.id)).toEqual(['q1-work']);
  });

  it('narrows to a part of life without scheduling anything', () => {
    const health = goal('health-goal', {
      startsOn: '2026-10-01',
      dueOn: '2026-12-31',
      primaryAreaId: 'health',
    });
    const groups = goalPeriodGroups([health, parent, someday], q4, {
      areaScope: new Set(['health']),
    });
    expect(groups.scheduled.map((node) => node.id)).toEqual(['health-goal']);
    expect(groups.unscheduled).toEqual([]);
  });
});
