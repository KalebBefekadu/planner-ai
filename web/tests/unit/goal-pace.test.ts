import { describe, expect, it } from 'vitest';
import { assessGoalPace, isDrifting, summariseDrift, type PaceGoal } from '@/lib/goal-pace';

const TODAY = '2026-08-30';

function goal(partial: Partial<PaceGoal> = {}): PaceGoal {
  return {
    content: 'Train four times a week',
    status: 'active',
    created_at: '2026-08-01',
    due_on: '2026-09-30',
    target_value: 100,
    current_value: 0,
    ...partial,
  };
}

describe('assessGoalPace', () => {
  it('calls a goal with no target unmeasurable rather than on track', () => {
    const result = assessGoalPace(goal({ target_value: null }), TODAY);
    expect(result.state).toBe('no-measure');
    expect(result.actual).toBeNull();
    // the important part: silence would imply everything is fine
    expect(result.reason).toContain('No measure');
  });

  it('treats a zero or negative target as no measure, not division by zero', () => {
    expect(assessGoalPace(goal({ target_value: 0 }), TODAY).state).toBe('no-measure');
    expect(assessGoalPace(goal({ target_value: -5 }), TODAY).state).toBe('no-measure');
  });

  it('reports a goal at its target as done even when the status lags', () => {
    const result = assessGoalPace(goal({ current_value: 100, status: 'active' }), TODAY);
    expect(result.state).toBe('done');
    expect(result.actual).toBe(1);
  });

  it('trusts an achieved status without needing numbers', () => {
    expect(assessGoalPace(goal({ status: 'achieved', target_value: null }), TODAY).state).toBe(
      'done'
    );
  });

  it('caps progress at the target when someone overshoots', () => {
    expect(assessGoalPace(goal({ current_value: 250 }), TODAY).actual).toBe(1);
  });

  it('cannot judge pace without a date, and says so', () => {
    const result = assessGoalPace(goal({ due_on: null, current_value: 10 }), TODAY);
    expect(result.state).toBe('no-deadline');
    expect(result.expected).toBeNull();
  });

  it('flags a goal with nothing recorded', () => {
    const result = assessGoalPace(goal({ current_value: 0 }), TODAY);
    expect(result.state).toBe('not-started');
    expect(result.reason).toContain('31 days left');
  });

  it('says "due today" rather than "0 days left"', () => {
    const result = assessGoalPace(goal({ due_on: TODAY, current_value: 0 }), TODAY);
    expect(result.reason).toContain('due today');
  });

  it('calls a goal past its date overdue, with how far past', () => {
    const result = assessGoalPace(goal({ due_on: '2026-08-20', current_value: 40 }), TODAY);
    expect(result.state).toBe('overdue');
    expect(result.reason).toContain('10 days');
  });

  it('flags a goal behind the pace its own date implies', () => {
    // 29 of 60 days elapsed -> ~48% expected; 10% actual is far behind
    const result = assessGoalPace(goal({ current_value: 10 }), TODAY);
    expect(result.state).toBe('at-risk');
    expect(result.reason).toMatch(/behind the pace/);
  });

  it('does not nag about being slightly behind', () => {
    // ~48% expected, 40% actual — inside the tolerance band
    const result = assessGoalPace(goal({ current_value: 40 }), TODAY);
    expect(result.state).toBe('on-track');
  });

  it('counts being ahead as on track', () => {
    expect(assessGoalPace(goal({ current_value: 90 }), TODAY).state).toBe('on-track');
  });

  it('survives a goal created on the day it is due', () => {
    const result = assessGoalPace(
      goal({ created_at: TODAY, due_on: TODAY, current_value: 1 }),
      TODAY
    );
    expect(Number.isFinite(result.expected ?? 0)).toBe(true);
    expect(result.expected).toBe(1);
  });

  it('survives a due date before the creation date', () => {
    const result = assessGoalPace(goal({ created_at: '2026-09-01', due_on: '2026-08-01' }), TODAY);
    expect(result.state).toBe('overdue');
    expect(Number.isNaN(result.actual ?? 0)).toBe(false);
  });

  it('includes the unit in what it reports back', () => {
    const result = assessGoalPace(
      goal({ current_value: 10, target_value: 100, unit: 'sessions' }),
      TODAY
    );
    expect(result.reason).toContain('10 of 100 sessions');
  });
});

describe('isDrifting', () => {
  it('counts behind, overdue and never-started as drift', () => {
    for (const current of [10, 0]) {
      expect(isDrifting(assessGoalPace(goal({ current_value: current }), TODAY))).toBe(true);
    }
    expect(isDrifting(assessGoalPace(goal({ due_on: '2026-01-01' }), TODAY))).toBe(true);
  });

  it('does not count on-track, done, or unmeasurable goals as drift', () => {
    expect(isDrifting(assessGoalPace(goal({ current_value: 90 }), TODAY))).toBe(false);
    expect(isDrifting(assessGoalPace(goal({ status: 'achieved' }), TODAY))).toBe(false);
    expect(isDrifting(assessGoalPace(goal({ target_value: null }), TODAY))).toBe(false);
  });
});

describe('summariseDrift', () => {
  it('says nothing when every goal is healthy', () => {
    const result = summariseDrift(
      [goal({ current_value: 90 }), goal({ status: 'achieved' })],
      TODAY
    );
    expect(result.headline).toBeNull();
  });

  it('counts drifting goals and reads naturally in the singular', () => {
    // "1 goal ... their measure" is the kind of thing that ships and grates
    const result = summariseDrift(
      [goal({ current_value: 10 }), goal({ current_value: 90 })],
      TODAY
    );
    expect(result.drifting).toBe(1);
    expect(result.headline).toBe('1 goal has drifted from its measure');
  });

  it('reads naturally in the plural', () => {
    const result = summariseDrift([goal({ current_value: 10 }), goal({ current_value: 0 })], TODAY);
    expect(result.headline).toBe('2 goals have drifted from their measure');
  });

  it('surfaces unmeasurable goals even when nothing is drifting', () => {
    const result = summariseDrift(
      [goal({ current_value: 90 }), goal({ target_value: null })],
      TODAY
    );
    expect(result.drifting).toBe(0);
    expect(result.headline).toBe('1 goal has no measure to check against');
  });

  it('mentions both when goals are drifting and others cannot be checked', () => {
    const result = summariseDrift(
      [goal({ current_value: 10 }), goal({ target_value: null })],
      TODAY
    );
    expect(result.headline).toContain('1 goal has drifted');
    expect(result.headline).toContain('1 goal cannot be checked');
  });

  it('handles an empty plan without inventing a problem', () => {
    expect(summariseDrift([], TODAY).headline).toBeNull();
  });
});
