import { describe, expect, it } from 'vitest';
import { applyWorkspaceWeekStart } from '@/app/today/actions';
import { planTodayAction, type TodayComposerInput } from '@/lib/today-composer';

// planTodayAction has no workspace to ask and anchors its weekly horizon to a
// Monday-first week. applyWorkspaceWeekStart is the orchestration seam that
// corrects that horizon to the signed-in workspace's own week start before the
// create Operation is sent, using the same periodBounds the rest of the
// planner already trusts for "this week" -- not a second, hand-rolled Monday
// rule living beside it.

const base: TodayComposerInput = {
  title: 'Draft the quarterly summary',
  goalId: null,
  scheduledOn: '2026-09-13', // a Sunday
  focus: false,
  requestKey: 'today-creation-fixture-key',
};

describe('applying the workspace week start to a Today creation plan', () => {
  it('leaves the Monday-first bounds alone for a workspace that also starts on Monday', async () => {
    const plan = planTodayAction(base, base.scheduledOn);
    const create = await applyWorkspaceWeekStart(plan.create, base.scheduledOn, 1);
    expect(create.startsOn).toBe('2026-09-07');
    expect(create.endsOn).toBe('2026-09-13');
  });

  it('moves a Sunday into the week that is just starting for a Sunday-first workspace', async () => {
    // The same calendar day belongs to two different weeks depending on the
    // workspace's own preference, and a Monday-anchored horizon would silently
    // misfile this Action into the week that already ended.
    const plan = planTodayAction(base, base.scheduledOn);
    const create = await applyWorkspaceWeekStart(plan.create, base.scheduledOn, 0);
    expect(create.startsOn).toBe('2026-09-13');
    expect(create.endsOn).toBe('2026-09-19');
  });

  it('does not touch a non-weekly horizon', async () => {
    const monthly = {
      horizonKind: 'month' as const,
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    };
    const create = await applyWorkspaceWeekStart(monthly, base.scheduledOn, 0);
    expect(create).toEqual(monthly);
  });
});
