import {
  index,
  integer,
  now,
  ownableColumns,
  table,
  text,
} from "@agent-native/core/db/schema";

/**
 * One table for every level of the planning cascade.
 *
 * The MVP shipped five near-identical tables (visions, yearly_goals,
 * quarterly_goals, monthly_tasks, weekly_actions) wired together by typed
 * foreign keys. That hardcodes a single cascade, and every custom hierarchy
 * would have meant a migration plus a new set of actions.
 *
 * Here the cascade is data: `tier` labels the level, `parentId` links a node to
 * the one above it. A Lean cascade is the Deep cascade with the "monthly" tier
 * absent — no schema change, and the agent learns one shape instead of five.
 */
export const planNodes = table(
  "plan_nodes",
  {
    id: text("id").primaryKey(),
    /**
     * Cascade level. Deliberately not an enum: custom cascades ("5-year",
     * "daily-habit") are a product goal, and the set of tiers a user has
     * configured lives in their settings, not in the column type.
     */
    tier: text("tier").notNull(),
    title: text("title").notNull(),
    /** Long-form body — the vision essay, the reasoning behind a goal. */
    detail: text("detail"),
    /** Null for a root node (a vision). Otherwise the node one tier up. */
    parentId: text("parent_id"),
    status: text("status").notNull().default("pending"),
    /** ISO dates bounding the node's horizon. Null for an open-ended vision. */
    horizonStart: text("horizon_start"),
    horizonEnd: text("horizon_end"),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Soft delete — the MVP's `deleted_at`, kept for the same reason. */
    archivedAt: text("archived_at"),
    ...ownableColumns(),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (node) => ({
    /** Hot path: rendering one level of the tree in display order. */
    byParent: index("idx_plan_nodes_owner_parent_sort").on(
      node.ownerEmail,
      node.parentId,
      node.sortOrder,
    ),
    /** Hot path: "show me every quarterly goal". */
    byTier: index("idx_plan_nodes_owner_tier").on(node.ownerEmail, node.tier),
  }),
);

export type PlanNode = typeof planNodes.$inferSelect;
export type NewPlanNode = typeof planNodes.$inferInsert;

/**
 * Raw voice/text brain dumps.
 *
 * `processedAt` is the seam for the Automated Progress Analyzer: a recurring
 * job claims unprocessed transcripts, cross-references them against the active
 * cascade, and stamps this column. Nothing reprocesses a transcript twice.
 */
export const transcripts = table(
  "transcripts",
  {
    id: text("id").primaryKey(),
    body: text("body").notNull(),
    /** "voice" when transcribed from audio, "text" when typed. */
    source: text("source").notNull().default("voice"),
    /** Optional: the node this dump was captured against. */
    nodeId: text("node_id"),
    capturedAt: text("captured_at").notNull().default(now()),
    /** Null until the coach has read it. */
    processedAt: text("processed_at"),
    archivedAt: text("archived_at"),
    ...ownableColumns(),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (transcript) => ({
    byCapturedAt: index("idx_transcripts_owner_captured").on(
      transcript.ownerEmail,
      transcript.capturedAt,
    ),
    /** Hot path for the analyzer job: unprocessed dumps, oldest first. */
    byProcessed: index("idx_transcripts_owner_processed").on(
      transcript.ownerEmail,
      transcript.processedAt,
    ),
  }),
);

export type Transcript = typeof transcripts.$inferSelect;
export type NewTranscript = typeof transcripts.$inferInsert;
