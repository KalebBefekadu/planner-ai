import { describe, expect, it } from 'vitest';
import {
  nextFocusIds,
  planTodayAction,
  TODAY_FOCUS_CAPACITY,
  TodayComposerInputError,
  type TodayComposerInput,
} from '@/lib/today-composer';

const base: TodayComposerInput = {
  title: 'Draft the quarterly summary',
  goalId: null,
  scheduledOn: '2026-09-08',
  focus: true,
  requestKey: 'today-composer-fixture-key',
};

describe('planning an Action created from Today', () => {
  it('puts the Action in the Monday-first week that contains its date', () => {
    const plan = planTodayAction(base, '2026-09-08');
    expect(plan.create.horizonKind).toBe('week');
    expect(plan.create.startsOn).toBe('2026-09-07');
    expect(plan.create.endsOn).toBe('2026-09-13');
    expect(plan.create.scheduledOn).toBe('2026-09-08');
  });

  it('keeps a Sunday in the week that just ended rather than the one starting', () => {
    // A Sunday evening entry belongs to the week the person is finishing.
    const plan = planTodayAction({ ...base, scheduledOn: '2026-09-13' }, '2026-09-13');
    expect(plan.create.startsOn).toBe('2026-09-07');
    expect(plan.create.endsOn).toBe('2026-09-13');
  });

  it('commits to focus only when the Action is scheduled for the workspace date', () => {
    expect(planTodayAction(base, '2026-09-08').focusIntent).toBe('commit');
    // The request crossed midnight in the workspace timezone: the Action is
    // still created for the date the person chose, but it is not silently
    // committed to a different day's focus list.
    expect(planTodayAction(base, '2026-09-09').focusIntent).toBe('other-day');
    expect(planTodayAction({ ...base, focus: false }, '2026-09-08').focusIntent).toBe(
      'not-requested'
    );
  });

  it('derives one idempotency key per submission so a retry cannot duplicate', () => {
    const first = planTodayAction(base, '2026-09-08');
    const second = planTodayAction({ ...base, focus: false }, '2026-09-09');
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    expect(first.idempotencyKey.length).toBeLessThanOrEqual(200);
  });

  it('trims the title and keeps an empty Goal selection as no Goal', () => {
    const plan = planTodayAction(
      { ...base, title: '  Write the brief  ', goalId: '' },
      '2026-09-08'
    );
    expect(plan.create.title).toBe('Write the brief');
    expect(plan.create.goalId).toBeNull();
  });

  it('rejects input the person can still correct', () => {
    expect(() => planTodayAction({ ...base, title: 'no' }, '2026-09-08')).toThrow(
      TodayComposerInputError
    );
    expect(() => planTodayAction({ ...base, scheduledOn: '' }, '2026-09-08')).toThrow(
      TodayComposerInputError
    );
    expect(() => planTodayAction({ ...base, scheduledOn: '2026-02-30' }, '2026-09-08')).toThrow();
    expect(() => planTodayAction({ ...base, requestKey: 'short' }, '2026-09-08')).toThrow(
      TodayComposerInputError
    );
  });
});

describe('adding a new Action to the daily focus list', () => {
  it('appends without disturbing the existing order', () => {
    expect(nextFocusIds(['one', 'two'], 'three')).toEqual(['one', 'two', 'three']);
  });

  it('refuses a full list instead of replacing a commitment already made', () => {
    const full = Array.from({ length: TODAY_FOCUS_CAPACITY }, (_, index) => `action-${index}`);
    expect(nextFocusIds(full, 'new')).toBe('full');
  });

  it('treats an Action already in focus as settled so a retry is harmless', () => {
    expect(nextFocusIds(['one', 'two'], 'two')).toBe('present');
  });
});
