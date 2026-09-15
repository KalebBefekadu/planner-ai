import { describe, expect, it } from 'vitest';
import {
  carriedLabel,
  countCheckpointsSince,
  isStalled,
  STALLED_AFTER_CHECKPOINTS,
} from '@/lib/reviews/checkpoints';
import {
  bandOpenByDefault,
  DEFAULT_REVIEW_DENSITY,
  groupOpenByDefault,
  parseReviewDensity,
} from '@/lib/reviews/density';

const checkpoints = [
  '2026-09-13T18:00:00.000Z',
  '2026-09-06T18:00:00.000Z',
  '2026-08-30T18:00:00.000Z',
  '2026-08-23T18:00:00.000Z',
];

describe('how long open work has been sitting', () => {
  it('counts only the reviews that happened after the Action was written', () => {
    expect(countCheckpointsSince(checkpoints, '2026-08-20T09:00:00.000Z')).toBe(4);
    expect(countCheckpointsSince(checkpoints, '2026-09-01T09:00:00.000Z')).toBe(2);
    expect(countCheckpointsSince(checkpoints, '2026-09-14T09:00:00.000Z')).toBe(0);
  });

  // The whole point of counting checkpoints instead of reschedule rows: an
  // Action written on Friday has survived nothing by Sunday, whatever the
  // calendar says about how many weeks it has touched.
  it('reports nothing survived for work created since the last review', () => {
    expect(countCheckpointsSince(checkpoints, '2026-09-13T18:00:01.000Z')).toBe(0);
    expect(carriedLabel(0)).toBe('new');
  });

  it('is exact on the boundary rather than off by one', () => {
    expect(countCheckpointsSince(checkpoints, '2026-09-13T18:00:00.000Z')).toBe(0);
    expect(countCheckpointsSince(checkpoints, '2026-09-13T17:59:59.999Z')).toBe(1);
  });

  it('reads back as the week the work is now in', () => {
    expect(carriedLabel(1)).toBe('2nd week');
    expect(carriedLabel(2)).toBe('3rd week');
    expect(carriedLabel(3)).toBe('4th week');
    expect(carriedLabel(10)).toBe('11th week');
    expect(carriedLabel(12)).toBe('13th week');
    expect(carriedLabel(20)).toBe('21st week');
  });

  it('starts asking for a decision at the third checkpoint and not before', () => {
    expect(STALLED_AFTER_CHECKPOINTS).toBe(3);
    expect(isStalled(2)).toBe(false);
    expect(isStalled(3)).toBe(true);
    expect(isStalled(9)).toBe(true);
  });

  it('survives a workspace that has never completed a review', () => {
    expect(countCheckpointsSince([], '2026-09-01T09:00:00.000Z')).toBe(0);
    expect(carriedLabel(countCheckpointsSince([], '2020-01-01T00:00:00.000Z'))).toBe('new');
  });
});

describe('how much of the week is shown', () => {
  it('falls back to showing everything for an unreadable preference', () => {
    expect(parseReviewDensity(null)).toBe(DEFAULT_REVIEW_DENSITY);
    expect(parseReviewDensity('enormous')).toBe(DEFAULT_REVIEW_DENSITY);
    expect(parseReviewDensity('headlines')).toBe('headlines');
  });

  it('closes the bands before it closes the groupings', () => {
    expect(groupOpenByDefault('full')).toBe(true);
    expect(bandOpenByDefault('full')).toBe(true);

    expect(groupOpenByDefault('compact')).toBe(true);
    expect(bandOpenByDefault('compact')).toBe(true);

    // Headlines is one row per grouping: the grouping itself is shut, so the
    // bands inside it never get the chance to render.
    expect(groupOpenByDefault('headlines')).toBe(false);
    expect(bandOpenByDefault('headlines')).toBe(false);
  });
});

describe('what closing a week costs', () => {
  // The invariant with a number attached: the work of closing a week is set by
  // how much has stalled, not by how much is open. A backlog that grows does
  // not make the ritual more expensive.
  function decisionsRequired(weeksCarriedPerAction: readonly number[]) {
    return weeksCarriedPerAction.filter((weeks) => isStalled(weeks)).length;
  }

  it('does not scale with the size of the backlog', () => {
    const smallWeek = [0, 0, 1, 2, 1];
    const hugeWeek = Array.from({ length: 150 }, (_, index) => index % 3);

    expect(decisionsRequired(smallWeek)).toBe(0);
    expect(decisionsRequired(hugeWeek)).toBe(0);
  });

  it('charges only for work that has stopped moving', () => {
    const week = [0, 1, 2, 3, 4, 9, 2, 0];
    expect(decisionsRequired(week)).toBe(3);
  });
});
