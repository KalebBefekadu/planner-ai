import { describe, expect, it } from 'vitest';
import {
  buildParentIndex,
  buildWeeklyGoals,
  dedupeActions,
  directionChain,
  finishedSinceWindow,
  goalIdsInWeek,
  lastCompletionByGoal,
} from '@/lib/reviews/weekly-view-model';

/* None of this was reachable before. Turning a week's rows into the screen the
   Weekly Review renders lived inside `getWeeklyReviewData`, so asking "what
   happens to a Goal that has never finished anything" meant standing up a
   database and a workspace and reading the result off a page. */

const goal = (id: string, title: string) => ({
  id,
  title,
  version: 1,
  status: 'active',
  definition_of_done: null,
});

describe('one list from two reads', () => {
  /* An Action filed in the week's horizon can also be scheduled into it, so it
     comes back from both queries. It may only be asked about once: a duplicate
     decision is refused as `duplicate_review_action`, which makes a duplicate
     on screen a question the person cannot answer. */
  it('keeps an Action that both reads returned exactly once', () => {
    const carried = { id: 'a' };
    expect(dedupeActions([carried, { id: 'b' }], [carried, { id: 'c' }]).map((r) => r.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps the order the first read saw', () => {
    expect(dedupeActions([{ id: 'b' }], [{ id: 'a' }]).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('survives either read coming back empty', () => {
    expect(dedupeActions(null, undefined, [{ id: 'a' }])).toEqual([{ id: 'a' }]);
    expect(dedupeActions()).toEqual([]);
  });
});

describe('which Goals the week is about', () => {
  it('names each Goal once, in the order first seen', () => {
    expect(
      goalIdsInWeek([
        { id: 'a', goals: goal('g2', 'Second') },
        { id: 'b', goals: goal('g1', 'First') },
        { id: 'c', goals: goal('g2', 'Second') },
      ])
    ).toEqual(['g2', 'g1']);
  });

  it('ignores Actions filed under no Goal at all', () => {
    expect(goalIdsInWeek([{ id: 'a', goals: null }, { id: 'b' }])).toEqual([]);
  });
});

describe('the last time anything closed', () => {
  /* The rows arrive newest first, so the first sighting of a Goal is its most
     recent completion. */
  it('takes the newest completion per Goal and ignores older ones', () => {
    const latest = lastCompletionByGoal([
      { goal_id: 'g1', completed_at: '2026-09-10T00:00:00Z' },
      { goal_id: 'g1', completed_at: '2026-01-01T00:00:00Z' },
      { goal_id: 'g2', completed_at: '2026-08-01T00:00:00Z' },
    ]);
    expect(latest.get('g1')).toBe('2026-09-10T00:00:00Z');
    expect(latest.get('g2')).toBe('2026-08-01T00:00:00Z');
  });

  it('skips a completion with no Goal behind it', () => {
    expect(lastCompletionByGoal([{ goal_id: null, completed_at: 'x' }]).size).toBe(0);
  });

  it('has nothing to say about a workspace that has closed nothing', () => {
    expect(lastCompletionByGoal(null).size).toBe(0);
  });
});

describe('what this work sits under', () => {
  const tree = buildParentIndex([
    { id: 'year', title: 'Ship the product', parent_goal_id: null },
    { id: 'quarter', title: 'Private beta', parent_goal_id: 'year' },
    { id: 'month', title: 'Invite the first ten', parent_goal_id: 'quarter' },
  ]);

  it('reads outermost first and leaves the Goal itself off', () => {
    expect(directionChain(tree, 'month')).toEqual(['Ship the product', 'Private beta']);
  });

  it('gives a top-level Goal an empty chain rather than its own title', () => {
    expect(directionChain(tree, 'year')).toEqual([]);
  });

  /* A malformed parent link would otherwise loop forever and hang the page
     rather than render a wrong one. */
  it('terminates on a cycle instead of hanging', () => {
    const cyclic = buildParentIndex([
      { id: 'a', title: 'A', parent_goal_id: 'b' },
      { id: 'b', title: 'B', parent_goal_id: 'a' },
    ]);
    expect(directionChain(cyclic, 'a')).toEqual(['B']);
  });

  it('stops at a parent that is not in the tree it was given', () => {
    const partial = buildParentIndex([{ id: 'child', title: 'Child', parent_goal_id: 'absent' }]);
    expect(directionChain(partial, 'child')).toEqual([]);
  });
});

describe('how long a Goal has been quiet', () => {
  const checkpoints = [
    '2026-09-13T00:00:00Z',
    '2026-09-06T00:00:00Z',
    '2026-08-30T00:00:00Z',
    '2026-08-23T00:00:00Z',
  ];
  const actions = [{ id: 'a1', goals: goal('g1', 'Launch') }];
  const parents = buildParentIndex([{ id: 'g1', title: 'Launch', parent_goal_id: null }]);

  /* The absence of a completion is the strongest version of the signal, not the
     weakest. Reporting it as zero would hide exactly the project worth
     pausing. */
  it('counts every checkpoint on record when nothing has ever closed', () => {
    const [built] = buildWeeklyGoals(actions, parents, new Map(), checkpoints);
    expect(built.quietCheckpoints).toBe(4);
  });

  it('counts only the checkpoints since the last completion', () => {
    const completions = new Map([['g1', '2026-09-01T00:00:00Z']]);
    const [built] = buildWeeklyGoals(actions, parents, completions, checkpoints);
    expect(built.quietCheckpoints).toBe(2);
  });

  it('reports a Goal that closed something this week as not quiet', () => {
    const completions = new Map([['g1', '2026-09-14T00:00:00Z']]);
    const [built] = buildWeeklyGoals(actions, parents, completions, checkpoints);
    expect(built.quietCheckpoints).toBe(0);
  });

  it('builds each Goal once however many Actions sit under it', () => {
    const many = [
      { id: 'a1', goals: goal('g1', 'Launch') },
      { id: 'a2', goals: goal('g1', 'Launch') },
    ];
    expect(buildWeeklyGoals(many, parents, new Map(), checkpoints)).toHaveLength(1);
  });

  it('defaults a Goal with no kind to an outcome rather than an initiative', () => {
    const [built] = buildWeeklyGoals(actions, parents, new Map(), checkpoints);
    expect(built.kind).toBe('outcome');
  });

  it('skips Actions filed under no Goal', () => {
    expect(buildWeeklyGoals([{ id: 'a', goals: null }], parents, new Map(), checkpoints)).toEqual(
      []
    );
  });
});

describe('where the finished list starts', () => {
  it('starts at the last completed Review', () => {
    expect(finishedSinceWindow(['2026-09-13T00:00:00Z'], '2026-09-14')).toEqual({
      finishedSince: '2026-09-13T00:00:00Z',
      finishedSinceIsFallback: false,
    });
  });

  /* A screen saying "since your last review" when there has never been one is
     telling the person something untrue, so the caller is told it is standing
     in and can say something else. */
  it('falls back to the week itself, and says that it did', () => {
    expect(finishedSinceWindow([], '2026-09-14')).toEqual({
      finishedSince: '2026-09-14T00:00:00.000Z',
      finishedSinceIsFallback: true,
    });
  });
});
