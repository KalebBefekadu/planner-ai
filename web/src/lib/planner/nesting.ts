/**
 * Work nests, and the nesting is how a task keeps its context.
 *
 * `actions.parent_action_id` has always meant "this Action sits under that
 * Action". The interface spent it on the monthly-to-weekly rollup and then read
 * the same column straight back out as the monthly id, so a task could never
 * sit under a task. Once a weekly Action may have a weekly parent, the rollup
 * has to be derived by walking up to the nearest Action on the monthly horizon
 * rather than by assuming the immediate parent is it.
 */

/**
 * Four levels of Actions. The bound exists because archive, trash and undo all
 * cascade through a whole subtree with recursive CTEs, and an unbounded tree
 * makes their cost unpredictable. Mirrored by `public.action_max_depth()`.
 */
export const MAX_ACTION_DEPTH = 4;

export type NestedAction = {
  id: string;
  parentActionId: string | null;
  horizonKind: string;
};

/** Every walk is bounded so malformed data cannot spin, guard or no guard. */
const WALK_LIMIT = 32;

/**
 * The nearest ancestor on the monthly horizon, or null when there is none.
 * Returns the Action's own id for a monthly Action, which is what a rollup
 * asking "which month does this belong to" means.
 */
export function nearestMonthlyAncestor(
  actionId: string,
  index: ReadonlyMap<string, NestedAction>
): string | null {
  let cursor: string | null = actionId;
  const seen = new Set<string>();
  for (let step = 0; cursor && step < WALK_LIMIT; step += 1) {
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    const node: NestedAction | undefined = index.get(cursor);
    if (!node) return null;
    if (node.horizonKind === 'month') return node.id;
    cursor = node.parentActionId;
  }
  return null;
}

/** How many Action ancestors this Action has. Zero for a root. */
export function ancestorDepth(actionId: string, index: ReadonlyMap<string, NestedAction>): number {
  let cursor = index.get(actionId)?.parentActionId ?? null;
  const seen = new Set<string>([actionId]);
  let depth = 0;
  while (cursor && !seen.has(cursor) && depth < WALK_LIMIT) {
    const node = index.get(cursor);
    if (!node) break;
    seen.add(cursor);
    depth += 1;
    cursor = node.parentActionId;
  }
  return depth;
}

export function indexActions(actions: readonly NestedAction[]): Map<string, NestedAction> {
  return new Map(actions.map((action) => [action.id, action]));
}
