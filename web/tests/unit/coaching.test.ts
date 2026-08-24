import { describe, expect, it } from 'vitest';
import {
  inboxCoachingCue,
  periodReviewCoachingCue,
  todayCoachingCue,
  weeklyReviewCoachingCue,
} from '@/lib/coaching';

describe('decision-point coaching', () => {
  it('uses the selected tone without inventing Workspace facts', () => {
    expect(todayCoachingCue('strict', { focusCount: 0, overdueCount: 2, blockedCount: 0 })).toEqual(
      {
        label: 'Do this next',
        message: 'Decide the fate of one overdue Action before adding more work.',
      }
    );
    expect(inboxCoachingCue('calm', 0).label).toBe('Gentle prompt');
  });

  it('prioritizes blocked work at Today and Review decision points', () => {
    expect(
      todayCoachingCue('direct', { focusCount: 2, overdueCount: 3, blockedCount: 1 }).message
    ).toContain('blocker');
    expect(
      weeklyReviewCoachingCue('direct', { actionCount: 4, blockedCount: 1 }).message
    ).toContain('blocked Action');
  });

  it('uses period evidence to challenge overcommitment', () => {
    expect(
      periodReviewCoachingCue('direct', { planned: 10, completed: 3, blocked: 0 }).message
    ).toContain('real capacity');
    expect(
      periodReviewCoachingCue('direct', { planned: 8, completed: 7, blocked: 0 }).message
    ).toContain('pattern worth repeating');
  });
});
