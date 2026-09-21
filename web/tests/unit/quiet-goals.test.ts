import { describe, expect, it } from 'vitest';
import { QUIET_AFTER_DAYS, quietGoals, type QuietGoalInput } from '@/lib/planner/quiet-goals';

const today = '2026-09-21';

function goal(overrides: Partial<QuietGoalInput> = {}): QuietGoalInput {
  return {
    id: 'g1',
    title: 'Ship the private beta',
    status: 'active',
    lastActivityAt: '2026-09-20T09:00:00Z',
    hasUpcomingWork: false,
    ...overrides,
  };
}

describe('which goals have gone quiet', () => {
  it('says nothing about a goal worked on recently', () => {
    expect(quietGoals([goal()], today)).toEqual([]);
  });

  it('reports a goal with no recorded work for a fortnight', () => {
    const result = quietGoals([goal({ lastActivityAt: '2026-09-01T09:00:00Z' })], today);
    expect(result).toHaveLength(1);
    /* Nineteen, not twenty: elapsed time is floored rather than counting
       calendar days, so the number shown never claims a longer silence than
       there has actually been. */
    expect(result[0].quietForDays).toBe(19);
  });

  it('does not report the day the threshold is one short', () => {
    const almost = quietGoals(
      [goal({ lastActivityAt: '2026-09-08T00:00:00Z' })],
      today,
      QUIET_AFTER_DAYS
    );
    expect(almost).toHaveLength(0);
    const just = quietGoals([goal({ lastActivityAt: '2026-09-07T00:00:00Z' })], today);
    expect(just).toHaveLength(1);
  });

  /* Pausing something is a decision the person already made. Listing it again
     as quiet is arguing with that decision, which is exactly the judgement
     this is not allowed to make. */
  it('leaves a paused goal alone, because pausing was the decision', () => {
    expect(quietGoals([goal({ status: 'paused', lastActivityAt: null })], today)).toEqual([]);
    expect(quietGoals([goal({ status: 'achieved', lastActivityAt: null })], today)).toEqual([]);
    expect(quietGoals([goal({ status: 'abandoned', lastActivityAt: null })], today)).toEqual([]);
  });

  /* Work already booked is attention, whatever the last fortnight looked
     like. Reporting it would be wrong about the plain fact. */
  it('does not report a goal with work already scheduled ahead', () => {
    expect(
      quietGoals([goal({ lastActivityAt: '2026-06-01T09:00:00Z', hasUpcomingWork: true })], today)
    ).toEqual([]);
  });

  it('reports a goal that has never had any work, and distinguishes it', () => {
    const result = quietGoals([goal({ lastActivityAt: null })], today);
    expect(result).toHaveLength(1);
    // Null rather than a huge number: it has not gone quiet, it has not started.
    expect(result[0].quietForDays).toBe(null);
    expect(result[0].lastActivityAt).toBe(null);
  });

  it('puts the longest silence first and the never-started last', () => {
    const result = quietGoals(
      [
        goal({ id: 'never', lastActivityAt: null }),
        goal({ id: 'recent-ish', lastActivityAt: '2026-09-05T09:00:00Z' }),
        goal({ id: 'oldest', lastActivityAt: '2026-07-01T09:00:00Z' }),
      ],
      today
    );
    expect(result.map((entry) => entry.id)).toEqual(['oldest', 'recent-ish', 'never']);
  });

  it('drops an unreadable timestamp rather than reporting a made-up number', () => {
    const result = quietGoals([goal({ lastActivityAt: 'not a date' })], today);
    expect(result).toHaveLength(1);
    expect(result[0].quietForDays).toBe(null);
  });
});
