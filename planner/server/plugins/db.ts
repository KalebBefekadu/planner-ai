import { runMigrations } from "@agent-native/core/db";

/**
 * Every entry carries a stable `name` slug alongside its version — version
 * numbers alone are not a safe identity when two branches extend the list
 * independently. See the `storing-data` skill.
 */
export default runMigrations(
  [
    {
      version: 1,
      name: "plan-nodes-table",
      sql: `CREATE TABLE IF NOT EXISTS plan_nodes (
        id TEXT PRIMARY KEY,
        tier TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        parent_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        horizon_start TEXT,
        horizon_end TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        owner_email TEXT NOT NULL DEFAULT 'local@localhost',
        org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    },
    {
      version: 2,
      name: "plan-nodes-owner-parent-sort-index",
      sql: `CREATE INDEX IF NOT EXISTS idx_plan_nodes_owner_parent_sort
        ON plan_nodes (owner_email, parent_id, sort_order)`,
    },
    {
      version: 3,
      name: "plan-nodes-owner-tier-index",
      sql: `CREATE INDEX IF NOT EXISTS idx_plan_nodes_owner_tier
        ON plan_nodes (owner_email, tier)`,
    },
    {
      version: 4,
      name: "transcripts-table",
      sql: `CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'voice',
        node_id TEXT,
        captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        processed_at TEXT,
        archived_at TEXT,
        owner_email TEXT NOT NULL DEFAULT 'local@localhost',
        org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    },
    {
      version: 5,
      name: "transcripts-owner-captured-index",
      sql: `CREATE INDEX IF NOT EXISTS idx_transcripts_owner_captured
        ON transcripts (owner_email, captured_at)`,
    },
    {
      version: 6,
      name: "transcripts-owner-processed-index",
      sql: `CREATE INDEX IF NOT EXISTS idx_transcripts_owner_processed
        ON transcripts (owner_email, processed_at)`,
    },
  ],
  { table: "planner_migrations" },
);
