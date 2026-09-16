// Turning the rows the Weekly Review reads into the shape it renders.
//
// EH-03 asks that Server Actions stay authentication, validation and
// translation adapters rather than domain implementations. The mutations here
// already obey that -- they go through Operations. The reads did not: nearly
// three hundred lines of `getWeeklyReviewData` interleaved queries with the
// reasoning that turns their results into a screen, and none of that reasoning
// could be asked a question without a database and a workspace behind it.
//
// Everything below takes rows and returns values. The queries stay in the
// action, because fetching is the part that genuinely needs a session.

import { countCheckpointsSince } from '@/lib/reviews/checkpoints';

export type GoalRow = {
  id: string;
  title: string;
  version: number;
  kind?: 'outcome' | 'initiative' | null;
  status: string;
  definition_of_done?: string | null;
};

export type ActionRow = {
  id: string;
  goals?: GoalRow | null;
};

export type GoalTreeRow = {
  id: string;
  title: string;
  parent_goal_id?: string | null;
};

export type CompletionRow = {
  goal_id?: string | null;
  completed_at?: unknown;
};

/**
 * One list from two reads.
 *
 * The week's Actions arrive from two queries -- those filed in the week's
 * horizon, and those scheduled into it from elsewhere -- and an Action can
 * satisfy both. It may only be asked about once: a duplicate decision is
 * refused by the Operation as `duplicate_review_action`, so a duplicate on
 * screen is a question the person cannot answer.
 */
export function dedupeActions<T extends { id: string }>(...lists: (T[] | null | undefined)[]): T[] {
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const list of lists) {
    for (const row of list ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

/** The distinct Goals the week has work under, in the order first seen. */
export function goalIdsInWeek(actions: ActionRow[]): string[] {
  return [
    ...new Set(actions.map((action) => action.goals?.id).filter((id): id is string => Boolean(id))),
  ];
}

/**
 * The last time anything closed under each Goal.
 *
 * The rows are expected newest first, so the first sighting of a Goal is its
 * most recent completion and later ones are ignored. Scoped to the Goals the
 * week actually has work under rather than read from a page of the workspace's
 * most recent completions: a Goal whose last completion fell off the end of a
 * workspace-wide page would be reported as having never finished anything, and
 * the screen would offer to pause a project that is moving.
 */
export function lastCompletionByGoal(
  rows: CompletionRow[] | null | undefined
): Map<string, string> {
  const latest = new Map<string, string>();
  for (const row of rows ?? []) {
    const goalId = row.goal_id ?? null;
    if (!goalId || latest.has(goalId)) continue;
    latest.set(goalId, String(row.completed_at));
  }
  return latest;
}

export type ParentIndex = Map<string, { title: string; parentGoalId: string | null }>;

export function buildParentIndex(rows: GoalTreeRow[] | null | undefined): ParentIndex {
  const index: ParentIndex = new Map();
  for (const row of rows ?? []) {
    index.set(String(row.id), {
      title: String(row.title),
      parentGoalId: row.parent_goal_id ?? null,
    });
  }
  return index;
}

/**
 * What this work sits under, outermost first, with the Goal itself left off --
 * the header already says what it is.
 *
 * "Why am I doing this" belongs on screen at the moment of deciding, not
 * reconstructable from three other pages afterwards. A malformed parent link
 * would otherwise loop forever, so the walk stops at the first id it has
 * already seen and is bounded by the size of the tree besides.
 */
export function directionChain(index: ParentIndex, goalId: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([goalId]);
  let cursor = index.get(goalId)?.parentGoalId ?? null;
  while (cursor && !seen.has(cursor) && chain.length < index.size) {
    const node = index.get(cursor);
    if (!node) break;
    chain.unshift(node.title);
    seen.add(cursor);
    cursor = node.parentGoalId;
  }
  return chain;
}

export type WeeklyGoalView = {
  id: string;
  title: string;
  version: number;
  kind: 'outcome' | 'initiative';
  status: string;
  definitionOfDone: string | null;
  directionChain: string[];
  quietCheckpoints: number;
};

/**
 * The Goals the week is about, each carrying how long it has been quiet.
 *
 * A Goal that has never closed anything has been quiet for every checkpoint on
 * record, not for zero of them -- the absence of a completion is the strongest
 * version of the signal, and reporting it as zero would hide exactly the
 * project worth pausing.
 */
export function buildWeeklyGoals(
  actions: ActionRow[],
  parents: ParentIndex,
  completions: Map<string, string>,
  checkpoints: string[]
): WeeklyGoalView[] {
  const goals = new Map<string, WeeklyGoalView>();
  for (const action of actions) {
    const goal = action.goals;
    if (!goal || goals.has(goal.id)) continue;
    const lastCompletion = completions.get(goal.id);
    goals.set(goal.id, {
      id: goal.id,
      title: goal.title,
      version: Number(goal.version),
      kind: goal.kind ?? 'outcome',
      status: goal.status,
      definitionOfDone: goal.definition_of_done ?? null,
      directionChain: directionChain(parents, goal.id),
      quietCheckpoints: lastCompletion
        ? countCheckpointsSince(checkpoints, lastCompletion)
        : checkpoints.length,
    });
  }
  return [...goals.values()];
}

/**
 * Where the "finished this week" window starts.
 *
 * Normally the last completed Review, because that is what the person last
 * saw. With no Review ever completed there is no such moment, so the week's
 * own start stands in -- and the caller is told it is standing in, because a
 * screen saying "since your last review" when there has never been one is
 * telling the person something untrue.
 */
export function finishedSinceWindow(
  checkpoints: string[],
  weekStartsOn: string
): { finishedSince: string; finishedSinceIsFallback: boolean } {
  return checkpoints.length === 0
    ? { finishedSince: `${weekStartsOn}T00:00:00.000Z`, finishedSinceIsFallback: true }
    : { finishedSince: checkpoints[0], finishedSinceIsFallback: false };
}
