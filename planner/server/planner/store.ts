import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { getDb } from "../db/index.js";
import {
  type NewPlanNode,
  type PlanNode,
  type Transcript,
  planNodes,
  transcripts,
} from "../db/schema.js";
import { AuthError, NotFoundError, UserInputError } from "../errors.js";

export function requireUserEmail(email: string | undefined): string {
  if (!email) throw new AuthError("Sign in required.");
  return email;
}

/** A plan node with its children nested underneath it. */
export type PlanNodeTree = PlanNode & { children: PlanNodeTree[] };

/**
 * Read every non-archived node the user owns and assemble the cascade in one
 * pass. Loading the whole tree in a single query is deliberate: a personal
 * planning cascade is tens of rows, and the alternative — one query per tier —
 * is the waterfall the `performance` skill warns about.
 */
export async function listPlan(
  input: { ownerEmail: string; includeArchived?: boolean },
  db = getDb(),
): Promise<PlanNodeTree[]> {
  const where = input.includeArchived
    ? eq(planNodes.ownerEmail, input.ownerEmail)
    : and(
        eq(planNodes.ownerEmail, input.ownerEmail),
        isNull(planNodes.archivedAt),
      );

  const rows = await db
    .select()
    .from(planNodes)
    .where(where)
    .orderBy(asc(planNodes.sortOrder), asc(planNodes.createdAt));

  const byId = new Map<string, PlanNodeTree>(
    rows.map((row) => [row.id, { ...row, children: [] }]),
  );
  const roots: PlanNodeTree[] = [];
  for (const node of byId.values()) {
    // A node whose parent is archived (and therefore absent) surfaces as a
    // root rather than vanishing — losing a subtree silently is worse than
    // showing it detached.
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function getNode(
  input: { ownerEmail: string; id: string },
  db = getDb(),
): Promise<PlanNode | null> {
  const [row] = await db
    .select()
    .from(planNodes)
    .where(
      and(eq(planNodes.ownerEmail, input.ownerEmail), eq(planNodes.id, input.id)),
    )
    .limit(1);
  return row ?? null;
}

/** Next sort position within a parent, so new nodes land at the bottom. */
async function nextSortOrder(
  ownerEmail: string,
  parentId: string | null,
  db = getDb(),
): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${planNodes.sortOrder})` })
    .from(planNodes)
    .where(
      and(
        eq(planNodes.ownerEmail, ownerEmail),
        parentId === null
          ? isNull(planNodes.parentId)
          : eq(planNodes.parentId, parentId),
      ),
    );
  return (row?.max ?? -1) + 1;
}

export async function createNode(
  input: {
    ownerEmail: string;
    tier: string;
    title: string;
    detail?: string;
    parentId?: string | null;
    horizonStart?: string;
    horizonEnd?: string;
  },
  db = getDb(),
): Promise<PlanNode> {
  const parentId = input.parentId ?? null;

  // Verifying the parent under the caller's own owner_email is what stops a
  // node being attached to someone else's tree, and what stops the caller
  // creating an orphan pointing at an id that does not exist.
  if (parentId !== null) {
    const parent = await getNode({ ownerEmail: input.ownerEmail, id: parentId }, db);
    if (!parent) throw new NotFoundError("Parent node not found.");
  }

  const timestamp = new Date().toISOString();
  const row: NewPlanNode = {
    id: crypto.randomUUID(),
    tier: input.tier,
    title: input.title,
    detail: input.detail ?? null,
    parentId,
    horizonStart: input.horizonStart ?? null,
    horizonEnd: input.horizonEnd ?? null,
    sortOrder: await nextSortOrder(input.ownerEmail, parentId, db),
    ownerEmail: input.ownerEmail,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db.insert(planNodes).values(row);
  const created = await getNode({ ownerEmail: input.ownerEmail, id: row.id }, db);
  if (!created) throw new Error("Node insert did not persist.");
  return created;
}

export type NodePatch = {
  title?: string;
  detail?: string | null;
  status?: string;
  parentId?: string | null;
  horizonStart?: string | null;
  horizonEnd?: string | null;
  sortOrder?: number;
  archived?: boolean;
};

/**
 * One orthogonal update taking a patch of fields, rather than an action per
 * field — every agent-exposed action costs a slot in the model's tool list.
 */
export async function updateNode(
  input: { ownerEmail: string; id: string; patch: NodePatch },
  db = getDb(),
): Promise<PlanNode> {
  const existing = await getNode({ ownerEmail: input.ownerEmail, id: input.id }, db);
  if (!existing) throw new NotFoundError("Node not found.");

  const { patch } = input;

  if (patch.parentId !== undefined && patch.parentId !== null) {
    if (patch.parentId === input.id) {
      throw new UserInputError("A node cannot be its own parent.");
    }
    const parent = await getNode(
      { ownerEmail: input.ownerEmail, id: patch.parentId },
      db,
    );
    if (!parent) throw new NotFoundError("Parent node not found.");
    if (await isDescendant(input.ownerEmail, patch.parentId, input.id, db)) {
      throw new UserInputError("That move would create a cycle.");
    }
  }

  const changes: Partial<NewPlanNode> = { updatedAt: new Date().toISOString() };
  if (patch.title !== undefined) changes.title = patch.title;
  if (patch.detail !== undefined) changes.detail = patch.detail;
  if (patch.status !== undefined) changes.status = patch.status;
  if (patch.parentId !== undefined) changes.parentId = patch.parentId;
  if (patch.horizonStart !== undefined) changes.horizonStart = patch.horizonStart;
  if (patch.horizonEnd !== undefined) changes.horizonEnd = patch.horizonEnd;
  if (patch.sortOrder !== undefined) changes.sortOrder = patch.sortOrder;
  if (patch.archived !== undefined) {
    changes.archivedAt = patch.archived ? new Date().toISOString() : null;
  }

  await db
    .update(planNodes)
    .set(changes)
    .where(
      and(eq(planNodes.ownerEmail, input.ownerEmail), eq(planNodes.id, input.id)),
    );

  const updated = await getNode({ ownerEmail: input.ownerEmail, id: input.id }, db);
  if (!updated) throw new Error("Node update did not persist.");
  return updated;
}

/** True when `candidateId` sits somewhere under `ancestorId`. */
async function isDescendant(
  ownerEmail: string,
  candidateId: string,
  ancestorId: string,
  db = getDb(),
): Promise<boolean> {
  let cursor: string | null = candidateId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === ancestorId) return true;
    if (seen.has(cursor)) return false; // pre-existing cycle; don't spin
    seen.add(cursor);
    const node: PlanNode | null = await getNode({ ownerEmail, id: cursor }, db);
    cursor = node?.parentId ?? null;
  }
  return false;
}

export async function captureTranscript(
  input: {
    ownerEmail: string;
    body: string;
    source?: string;
    nodeId?: string | null;
    capturedAt?: string;
  },
  db = getDb(),
): Promise<Transcript> {
  if (input.nodeId) {
    const node = await getNode({ ownerEmail: input.ownerEmail, id: input.nodeId }, db);
    if (!node) throw new NotFoundError("Node not found.");
  }

  const timestamp = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.insert(transcripts).values({
    id,
    body: input.body,
    source: input.source ?? "voice",
    nodeId: input.nodeId ?? null,
    capturedAt: input.capturedAt ?? timestamp,
    ownerEmail: input.ownerEmail,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const [created] = await db
    .select()
    .from(transcripts)
    .where(
      and(eq(transcripts.ownerEmail, input.ownerEmail), eq(transcripts.id, id)),
    )
    .limit(1);
  if (!created) throw new Error("Transcript insert did not persist.");
  return created;
}

export async function listTranscripts(
  input: { ownerEmail: string; limit?: number; unprocessedOnly?: boolean },
  db = getDb(),
): Promise<Transcript[]> {
  const filters = [
    eq(transcripts.ownerEmail, input.ownerEmail),
    isNull(transcripts.archivedAt),
  ];
  if (input.unprocessedOnly) filters.push(isNull(transcripts.processedAt));

  return db
    .select()
    .from(transcripts)
    .where(and(...filters))
    .orderBy(desc(transcripts.capturedAt))
    .limit(input.limit ?? 20);
}
