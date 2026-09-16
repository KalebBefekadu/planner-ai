import { describe, expect, it } from 'vitest';
import {
  ancestorDepth,
  indexActions,
  MAX_ACTION_DEPTH,
  nearestMonthlyAncestor,
} from '@/lib/planner/nesting';

const tree = indexActions([
  { id: 'month', parentActionId: null, horizonKind: 'month' },
  { id: 'baily', parentActionId: 'month', horizonKind: 'week' },
  { id: 'wait', parentActionId: 'baily', horizonKind: 'week' },
  { id: 'date', parentActionId: 'wait', horizonKind: 'week' },
  { id: 'loose', parentActionId: null, horizonKind: 'week' },
]);

describe('reading the monthly rollup through a nested tree', () => {
  // The defect this exists to prevent: monthly_id was read straight off
  // parent_action_id, so the moment a weekly Action had a weekly parent the
  // rollup started reporting a sibling task as the month.
  it('walks past weekly parents to the month the work belongs to', () => {
    expect(nearestMonthlyAncestor('baily', tree)).toBe('month');
    expect(nearestMonthlyAncestor('wait', tree)).toBe('month');
    expect(nearestMonthlyAncestor('date', tree)).toBe('month');
  });

  it('answers with itself for work already planned monthly', () => {
    expect(nearestMonthlyAncestor('month', tree)).toBe('month');
  });

  it('reports nothing for work that hangs off no month at all', () => {
    expect(nearestMonthlyAncestor('loose', tree)).toBe(null);
    expect(nearestMonthlyAncestor('missing', tree)).toBe(null);
  });

  it('terminates on a cycle rather than spinning', () => {
    const cyclic = indexActions([
      { id: 'a', parentActionId: 'b', horizonKind: 'week' },
      { id: 'b', parentActionId: 'a', horizonKind: 'week' },
    ]);
    expect(nearestMonthlyAncestor('a', cyclic)).toBe(null);
    expect(ancestorDepth('a', cyclic)).toBeLessThan(32);
  });
});

describe('how deep work sits', () => {
  it('counts the Actions above it and not itself', () => {
    expect(ancestorDepth('month', tree)).toBe(0);
    expect(ancestorDepth('baily', tree)).toBe(1);
    expect(ancestorDepth('wait', tree)).toBe(2);
    expect(ancestorDepth('date', tree)).toBe(3);
  });

  it('agrees with the bound the database enforces', () => {
    expect(MAX_ACTION_DEPTH).toBe(4);
    expect(ancestorDepth('date', tree)).toBe(MAX_ACTION_DEPTH - 1);
  });
});
