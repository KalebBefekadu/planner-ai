/* The rules about a tree of life areas, as functions over plain rows.
 *
 * Three of them are the ones worth having outside a component and outside the
 * database: which areas are visible when an ancestor is archived, which areas a
 * page's scope covers, and whether an item belongs to that scope. Each is a
 * decision the interface makes on every render, and each has an edge case --
 * a child archived on its own, a cycle that a corrupt read could still present,
 * an item counted twice because it appears under a parent and a child -- that
 * is far easier to pin in a test than to notice on screen.
 */

export type AreaRow = {
  id: string;
  parentAreaId: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  sortKey: number;
  canonicalNoteId: string;
  aiExcluded: boolean;
  version: number;
  archivedAt: string | null;
};

export type AreaNode = AreaRow & {
  depth: number;
  children: AreaNode[];
  /** Archived itself, or under something archived. */
  hiddenByAncestor: boolean;
};

/** A guard, not a policy: the database already refuses to make a cycle. */
const MAX_DEPTH = 64;

function bySiblingOrder(left: AreaRow, right: AreaRow) {
  if (left.sortKey !== right.sortKey) return left.sortKey - right.sortKey;
  return left.id.localeCompare(right.id);
}

/**
 * Build the forest. `hiddenByAncestor` is computed from ancestors rather than
 * read from each row, which is what lets a parent be restored without
 * un-archiving a child that was archived on its own.
 */
export function buildAreaTree(rows: readonly AreaRow[]): AreaNode[] {
  const byParent = new Map<string | null, AreaRow[]>();
  for (const row of rows) {
    const siblings = byParent.get(row.parentAreaId);
    if (siblings) siblings.push(row);
    else byParent.set(row.parentAreaId, [row]);
  }
  for (const siblings of byParent.values()) siblings.sort(bySiblingOrder);

  const known = new Set(rows.map((row) => row.id));
  const seen = new Set<string>();

  function build(parentId: string | null, depth: number, hidden: boolean): AreaNode[] {
    if (depth > MAX_DEPTH) return [];
    return (byParent.get(parentId) ?? [])
      .filter((row) => !seen.has(row.id))
      .map((row) => {
        seen.add(row.id);
        const hiddenByAncestor = hidden || row.archivedAt !== null;
        return {
          ...row,
          depth,
          hiddenByAncestor,
          children: build(row.id, depth + 1, hiddenByAncestor),
        };
      });
  }

  const roots = build(null, 0, false);
  /* A row whose parent is not in the set -- because the parent is filtered out
     of this read, not because the tree is broken -- would otherwise vanish. It
     is shown at the root rather than dropped. */
  const orphans = rows
    .filter((row) => !seen.has(row.id) && row.parentAreaId !== null && !known.has(row.parentAreaId))
    .sort(bySiblingOrder)
    .map((row) => {
      seen.add(row.id);
      return {
        ...row,
        depth: 0,
        hiddenByAncestor: row.archivedAt !== null,
        children: build(row.id, 1, row.archivedAt !== null),
      };
    });

  return [...roots, ...orphans];
}

/** Depth-first, in sibling order: the order the tree is read on screen. */
export function flattenAreaTree(nodes: readonly AreaNode[]): AreaNode[] {
  const out: AreaNode[] = [];
  for (const node of nodes) {
    out.push(node);
    out.push(...flattenAreaTree(node.children));
  }
  return out;
}

/** The areas a person navigating the tree should see. */
export function visibleAreas(nodes: readonly AreaNode[]): AreaNode[] {
  return flattenAreaTree(nodes).filter((node) => !node.hiddenByAncestor);
}

/**
 * The ids an area page's content covers. `descendants` is the default, because
 * Health with nothing directly in it and three busy subareas is not an empty
 * page. "This area only" is the explicit narrowing.
 */
export function areaScopeIds(
  rows: readonly AreaRow[],
  areaId: string,
  scope: 'descendants' | 'self'
): string[] {
  if (scope === 'self') return [areaId];
  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentAreaId) continue;
    const list = childrenOf.get(row.parentAreaId);
    if (list) list.push(row.id);
    else childrenOf.set(row.parentAreaId, [row.id]);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [areaId];
  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  return out;
}

/** Root to this area, inclusive. Used for the breadcrumb and for inheritance. */
export function areaAncestry(rows: readonly AreaRow[], areaId: string): AreaRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const path: AreaRow[] = [];
  const seen = new Set<string>();
  let current = byId.get(areaId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentAreaId ? byId.get(current.parentAreaId) : undefined;
  }
  return path;
}

/**
 * Whether AI may see this area. Exclusion is inherited: excluding Health
 * excludes Movement under it, and an item reached through Movement stays
 * excluded however else it is reached.
 */
export function areaExcludedFromAi(rows: readonly AreaRow[], areaId: string | null): boolean {
  if (!areaId) return false;
  return areaAncestry(rows, areaId).some((area) => area.aiExcluded);
}

/** Every area id AI must not retrieve, resolved once for a whole workspace. */
export function aiExcludedAreaIds(rows: readonly AreaRow[]): Set<string> {
  const excluded = new Set<string>();
  for (const row of rows) {
    if (areaExcludedFromAi(rows, row.id)) excluded.add(row.id);
  }
  return excluded;
}

/**
 * Count distinct items, never occurrences. The same task is reachable under a
 * parent and under the child it is filed in, and a total that says two is a
 * total the person cannot reconcile with the list beneath it.
 */
export function countDistinct<T extends { id: string }>(items: readonly T[]): number {
  return new Set(items.map((item) => item.id)).size;
}

/** A sort key that puts a new area after `after`, or at the end of the list. */
export function sortKeyForPosition(siblings: readonly AreaRow[], afterId: string | null): number {
  const ordered = [...siblings].sort(bySiblingOrder);
  if (!ordered.length) return 1000;
  if (afterId === null) return ordered[0].sortKey - 1000;
  const index = ordered.findIndex((row) => row.id === afterId);
  if (index === -1 || index === ordered.length - 1) {
    return ordered[ordered.length - 1].sortKey + 1000;
  }
  return (ordered[index].sortKey + ordered[index + 1].sortKey) / 2;
}
