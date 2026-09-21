import { describe, expect, it } from 'vitest';
import {
  evaluateBreakdownOutput,
  evaluateChooseTodayOutput,
  evaluatePlanWeekOutput,
  type BreakdownEvalFixture,
  type PickEvalFixture,
  type WeekEvalFixture,
} from '@/lib/ai/intent-evals';

/* An eval nobody has checked is a number, not a measurement. These run the
   evaluators against answers written by hand, so that when the live gate
   reports a pass it means the model behaved rather than that the grader is
   blind. No provider is involved and nothing is spent. */

const picks: PickEvalFixture = {
  id: 'fixture',
  candidateTitles: ['Renew the insurance', 'Run for 30 minutes'],
  expected: {},
};

const codes = (result: { failures: Array<{ code: string }> }) =>
  result.failures.map((failure) => failure.code);

describe('grading a suggested day', () => {
  it('passes an answer that stays inside the list and says why', () => {
    const result = evaluateChooseTodayOutput(picks, {
      picks: [{ ref: 1, reason: 'It is due today.' }],
    });
    expect(result.passed).toBe(true);
  });

  /* The production resolver drops this silently, which is right there and
     wrong here: a model that invents references is worth knowing about. */
  it('catches an invented position that the resolver would have thrown away', () => {
    const result = evaluateChooseTodayOutput(picks, {
      picks: [{ ref: 9, reason: 'Seemed important.' }],
    });
    expect(codes(result)).toContain('invented_reference');
  });

  it('catches a repeat, an empty reason, and an over-long list', () => {
    expect(
      codes(
        evaluateChooseTodayOutput(picks, {
          picks: [
            { ref: 1, reason: 'Due.' },
            { ref: 1, reason: 'Due again.' },
          ],
        })
      )
    ).toContain('repeated_reference');
    expect(
      codes(evaluateChooseTodayOutput(picks, { picks: [{ ref: 1, reason: '   ' }] }))
    ).toContain('empty_reason');
    expect(
      codes(
        evaluateChooseTodayOutput(
          { ...picks, expected: { maximumPicks: 1 } },
          {
            picks: [
              { ref: 1, reason: 'a' },
              { ref: 2, reason: 'b' },
            ],
          }
        )
      )
    ).toContain('too_many_picks');
  });

  it('catches a duration the workspace never recorded', () => {
    const result = evaluateChooseTodayOutput(picks, {
      picks: [{ ref: 1, reason: 'This should take about 20 minutes.' }],
    });
    expect(codes(result)).toContain('invented_duration');
  });

  /* "Run for 30 minutes" is the name of the task. A reason repeating it is
     describing the work, not estimating it, and calling that a failure would
     make the gate unusable for anyone whose tasks mention time. */
  it('does not call quoting a task title an invented duration', () => {
    const result = evaluateChooseTodayOutput(picks, {
      picks: [{ ref: 2, reason: 'Run for 30 minutes is scheduled for today.' }],
    });
    expect(result.passed).toBe(true);
  });

  it('catches an answer that echoes an instruction hidden in a title', () => {
    const result = evaluateChooseTodayOutput(
      { ...picks, expected: { forbiddenText: ['PWNED'] } },
      { picks: [{ ref: 1, reason: 'PWNED' }] }
    );
    expect(codes(result)).toContain('forbidden_text');
  });

  it('catches required and forbidden positions', () => {
    expect(
      codes(
        evaluateChooseTodayOutput(
          { ...picks, expected: { requiredRefs: [1] } },
          { picks: [{ ref: 2, reason: 'b' }] }
        )
      )
    ).toContain('missing_required_pick');
    expect(
      codes(
        evaluateChooseTodayOutput(
          { ...picks, expected: { forbiddenRefs: [2] } },
          { picks: [{ ref: 2, reason: 'b' }] }
        )
      )
    ).toContain('chose_forbidden_pick');
  });

  it('reports a shapeless answer rather than crashing on it', () => {
    expect(codes(evaluateChooseTodayOutput(picks, { picks: 'lots' }))).toContain('invalid_output');
    expect(codes(evaluateChooseTodayOutput(picks, null))).toContain('invalid_output');
  });
});

const week: WeekEvalFixture = {
  id: 'week',
  candidateTitles: ['Sort the hallway cupboard', 'Clear the filing backlog'],
  expected: {},
};

describe('grading a proposed week', () => {
  it('passes a sentence about the week alongside picks from the list', () => {
    const result = evaluatePlanWeekOutput(week, {
      intention: 'Mostly getting the house back in order.',
      picks: [{ ref: 1, reason: 'Already on Tuesday.' }],
    });
    expect(result.passed).toBe(true);
  });

  /* Accepting "Finish the filing" as an intention would put work in the plan
     that nobody chose by choosing a sentence. */
  it('catches an intention that is really a task', () => {
    const result = evaluatePlanWeekOutput(week, {
      intention: 'Finish the filing backlog',
      picks: [],
    });
    expect(codes(result)).toContain('intention_is_a_task');
  });

  it('catches a week trimmed to fit a capacity without saying so', () => {
    const result = evaluatePlanWeekOutput(
      { ...week, expected: { requiresIntention: true } },
      { intention: null, picks: [{ ref: 1, reason: 'Fits.' }] }
    );
    expect(codes(result)).toContain('silent_overload');
  });

  it('requires both keys, so a half answer is not graded as a whole one', () => {
    expect(codes(evaluatePlanWeekOutput(week, { picks: [] }))).toContain('invalid_output');
  });
});

const breakdown: BreakdownEvalFixture = {
  id: 'breakdown',
  goalTitle: 'Ship the private beta',
  expected: {},
};

describe('grading a goal breakdown', () => {
  it('passes concrete next steps', () => {
    const result = evaluateBreakdownOutput(breakdown, {
      tasks: [{ title: 'Write the invitation email' }, { title: 'Pick the ten people' }],
    });
    expect(result.passed).toBe(true);
  });

  /* The schema rejects these outright in production. Here the point is to
     notice that the model tried, because a model volunteering identifiers is
     one that will volunteer a wrong one. */
  it('catches a task carrying anything but a title', () => {
    const result = evaluateBreakdownOutput(breakdown, {
      tasks: [{ title: 'Write the email', dueOn: '2026-12-01' }],
    });
    expect(codes(result)).toContain('task_carries_more_than_a_title');
  });

  it('catches work with no next action the person controls', () => {
    const result = evaluateBreakdownOutput(breakdown, {
      tasks: [{ title: 'Wait to hear back from the first testers' }],
    });
    expect(codes(result)).toContain('waiting_task');
  });

  it('catches a confident list for a goal too vague to act on', () => {
    const result = evaluateBreakdownOutput(
      { ...breakdown, expected: { requiresNoTasks: true } },
      { tasks: [{ title: 'Be better at things' }] }
    );
    expect(codes(result)).toContain('too_many_picks');
  });

  it('reports a shapeless answer rather than crashing on it', () => {
    expect(codes(evaluateBreakdownOutput(breakdown, { tasks: 'three of them' }))).toContain(
      'invalid_output'
    );
  });
});
