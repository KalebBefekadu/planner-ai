export const TIERS = [
  "vision",
  "yearly",
  "quarterly",
  "monthly",
  "weekly",
] as const;

export type Tier = (typeof TIERS)[number];

export type NodeStatus = "pending" | "in_progress" | "done" | "dropped";

export interface PlanNodeView {
  id: string;
  tier: string;
  title: string;
  detail: string | null;
  parentId: string | null;
  status: string;
  horizonStart: string | null;
  horizonEnd: string | null;
  sortOrder: number;
  archivedAt: string | null;
  children: PlanNodeView[];
}

/** The tier a child of `tier` should default to, or null at the leaf. */
export function childTier(tier: string): Tier | null {
  const index = TIERS.indexOf(tier as Tier);
  if (index === -1 || index === TIERS.length - 1) return null;
  return TIERS[index + 1];
}

/**
 * Status advances on click: pending → in progress → done → pending.
 * `dropped` is deliberately outside the cycle — abandoning a goal should be a
 * considered choice from the menu, not something a stray click can do.
 */
export function nextStatus(status: string): NodeStatus {
  switch (status) {
    case "pending":
      return "in_progress";
    case "in_progress":
      return "done";
    default:
      return "pending";
  }
}

/** Completion across a node's whole subtree, for the progress ring. */
export function subtreeProgress(node: PlanNodeView): {
  done: number;
  total: number;
} {
  let done = 0;
  let total = 0;
  for (const child of node.children) {
    if (child.status === "dropped") continue;
    total += 1;
    if (child.status === "done") done += 1;
    const nested = subtreeProgress(child);
    done += nested.done;
    total += nested.total;
  }
  return { done, total };
}
