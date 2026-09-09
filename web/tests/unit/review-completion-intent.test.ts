import { describe, expect, it } from 'vitest';
import {
  periodReviewIntentKey,
  weeklyReviewIntentKey,
  type ReviewIntentDecision,
} from '@/lib/reviews/completion-intent';

function decision(overrides: Partial<ReviewIntentDecision> = {}): ReviewIntentDecision {
  return {
    actionId: '11111111-1111-4111-8111-111111111111',
    expectedVersion: 1,
    resolution: 'done',
    reason: null,
    priority: false,
    ...overrides,
  };
}

const week = {
  startsOn: '2026-03-02',
  endsOn: '2026-03-08',
  reflectionMarkdown: 'A steady week.',
  decisions: [decision()],
};

describe('weeklyReviewIntentKey', () => {
  it('is stable for an unchanged resubmission', () => {
    expect(weeklyReviewIntentKey(week, 0)).toBe(weeklyReviewIntentKey({ ...week }, 0));
  });

  it('still names the week it belongs to', () => {
    expect(weeklyReviewIntentKey(week, 0).startsWith('weekly-review:2026-03-02:')).toBe(true);
  });

  it('stays inside the length an Operation key is allowed', () => {
    const key = weeklyReviewIntentKey(week, 0);
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(200);
  });

  it('changes when the reflection changes', () => {
    expect(weeklyReviewIntentKey({ ...week, reflectionMarkdown: 'Rewritten.' }, 0)).not.toBe(
      weeklyReviewIntentKey(week, 0)
    );
  });

  it('changes when a decision changes', () => {
    expect(
      weeklyReviewIntentKey({ ...week, decisions: [decision({ resolution: 'next_week' })] }, 0)
    ).not.toBe(weeklyReviewIntentKey(week, 0));
  });

  it('changes when a decision reason or priority changes', () => {
    expect(
      weeklyReviewIntentKey(
        {
          ...week,
          decisions: [decision({ resolution: 'blocked', reason: 'waiting on review' })],
        },
        0
      )
    ).not.toBe(
      weeklyReviewIntentKey({ ...week, decisions: [decision({ resolution: 'blocked' })] }, 0)
    );
    expect(
      weeklyReviewIntentKey({ ...week, decisions: [decision({ priority: true })] }, 0)
    ).not.toBe(weeklyReviewIntentKey(week, 0));
  });

  it('changes when a decision is added', () => {
    expect(
      weeklyReviewIntentKey(
        {
          ...week,
          decisions: [decision(), decision({ actionId: '22222222-2222-4222-8222-222222222222' })],
        },
        0
      )
    ).not.toBe(weeklyReviewIntentKey(week, 0));
  });

  it('does not change when the same decisions arrive in a different order', () => {
    const first = decision();
    const second = decision({ actionId: '22222222-2222-4222-8222-222222222222' });
    expect(weeklyReviewIntentKey({ ...week, decisions: [first, second] }, 0)).toBe(
      weeklyReviewIntentKey({ ...week, decisions: [second, first] }, 0)
    );
  });

  it('changes when an undo has opened a new generation', () => {
    expect(weeklyReviewIntentKey(week, 1)).not.toBe(weeklyReviewIntentKey(week, 0));
    expect(weeklyReviewIntentKey(week, 1)).toBe(weeklyReviewIntentKey({ ...week }, 1));
  });

  it('separates two different weeks', () => {
    expect(weeklyReviewIntentKey({ ...week, startsOn: '2026-03-09' }, 0)).not.toBe(
      weeklyReviewIntentKey(week, 0)
    );
  });
});

describe('periodReviewIntentKey', () => {
  const month = {
    kind: 'monthly' as const,
    startsOn: '2026-03-01',
    endsOn: '2026-03-31',
    reflectionMarkdown: 'March held together.',
  };

  it('is stable for an unchanged resubmission and names its period', () => {
    expect(periodReviewIntentKey(month, 0)).toBe(periodReviewIntentKey({ ...month }, 0));
    expect(periodReviewIntentKey(month, 0).startsWith('monthly-review:2026-03-01:')).toBe(true);
  });

  it('changes when an undo has opened a new generation', () => {
    expect(periodReviewIntentKey(month, 1)).not.toBe(periodReviewIntentKey(month, 0));
  });

  it('changes when the reflection changes', () => {
    expect(periodReviewIntentKey({ ...month, reflectionMarkdown: 'Rewritten.' }, 0)).not.toBe(
      periodReviewIntentKey(month, 0)
    );
  });

  it('separates monthly from quarterly for the same start', () => {
    expect(
      periodReviewIntentKey({ ...month, kind: 'quarterly', endsOn: '2026-03-31' }, 0)
    ).not.toBe(periodReviewIntentKey(month, 0));
  });

  it('stays inside the length an Operation key is allowed', () => {
    const key = periodReviewIntentKey(month, 0);
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(200);
  });
});
