import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { exportTables } from '@/app/api/export/route';

/* IM-08 (#186): the Notes vault carries Notes only, and the settings screen now
 * tells the owner that their plan lives in the full Workspace export instead.
 * That sentence is a promise, and a promise about what a file contains is only
 * worth making if something fails when it stops being true.
 *
 * The first version of this file listed the tables someone remembered and
 * checked those were present. It passed for months while `life_areas`,
 * `projects`, `weekly_plans`, `weekly_plan_items`, `weekly_plan_snapshots` and
 * the owner's own preferences were all absent from the export -- because a
 * list of what to check, maintained by hand, only ever covers what somebody
 * thought of, and a new table is exactly the thing nobody thought of.
 *
 * So the question is inverted, the way `bounded-reads.test.ts` inverts it.
 * Every table the schema has is either exported or written down here with the
 * reason it is not. A new table fails this test until someone decides which,
 * which turns "nobody thought about it" into "someone decided". */

const NOT_EXPORTED = new Map<string, string>([
  // Infrastructure the product rebuilds for itself. Restoring a stale copy
  // would describe an older build than the one reading it.
  ['operation_contracts', 'the Operation manifest, written by migrations rather than by a person'],
  ['operation_undo_support', 'undo strategies, written by migrations'],
  ['lifecycle_job_runs', 'the background job log, about this deployment and not about the owner'],

  // Transient. None of it outlives the request or transaction that made it,
  // so a copy in a file is a record of nothing.
  ['ai_jobs', 'the status of an AI request that has since finished or failed'],
  ['operation_before_images', 'the undo buffer for one transaction, claimed and deleted within it'],

  // Rate-limiting counters. They exist to throttle the next hour, and a
  // restored copy would throttle against a window that has passed.
  ['ai_quota_reservations', 'in-flight AI spend holds, released when the request ends'],
  ['ai_request_windows', 'per-window AI request counters'],
  ['mcp_usage_windows', 'per-window MCP request counters'],
  ['mcp_oauth_usage_windows', 'per-window MCP OAuth request counters'],

  // Credentials and identity. An export is a copy of your data that may be
  // read anywhere; a live token in it is a token in a file on a laptop. The
  // grants themselves are exported without their secrets, above.
  [
    'beta_invites',
    'invitation codes, which are not workspace content and are not the owner’s to carry',
  ],
]);

const GENERATED_TYPES = 'src/types/supabase.generated.ts';

/**
 * Every table in `public`, read from the generated types.
 *
 * Those types are produced from the database by `npm run types:generate`, and
 * `npm run verify:db` fails when they drift from it, so they are a faithful
 * schema without this test needing a database to talk to.
 */
function schemaTables(): string[] {
  const lines = readFileSync(GENERATED_TYPES, 'utf8').split('\n');
  const start = lines.findIndex((line) => line === '    Tables: {');
  if (start === -1) throw new Error('Could not find the Tables block in the generated types.');
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line === '    };') break;
    const match = /^ {6}(\w+): \{$/.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

const tableNames = exportTables.map(([table]) => table);

describe('the full Workspace export', () => {
  /* If the parse above ever breaks, every assertion below would pass over an
     empty list and this file would guard nothing. It is worth one test to
     know that has not happened. */
  it('can actually read the schema it is checking against', () => {
    const tables = schemaTables();
    expect(tables.length).toBeGreaterThan(50);
    expect(tables).toContain('actions');
    expect(tables).toContain('notes');
  });

  it('exports every table, or records why it does not', () => {
    // Widened: `exportTables` is `as const`, so this is a union of literals
    // and the schema list it is compared against is plain strings.
    const exported = new Set<string>(tableNames);
    const undecided = schemaTables().filter(
      (table) => !exported.has(table) && !NOT_EXPORTED.has(table)
    );
    expect(
      undecided.sort(),
      'a table that is neither exported nor recorded as deliberately left out'
    ).toEqual([]);
  });

  /* The reverse direction: an entry here for a table that no longer exists is
     a decision about nothing, and reading it later would suggest the export
     covers ground it does not. */
  it('names no table the schema does not have', () => {
    const schema = new Set(schemaTables());
    const stale = [...tableNames, ...NOT_EXPORTED.keys()].filter((table) => !schema.has(table));
    expect(stale.sort(), 'named in the export or its exclusions, but not in the schema').toEqual(
      []
    );
  });

  it('gives a reason for every table it leaves out', () => {
    for (const [table, reason] of NOT_EXPORTED) {
      expect(reason.length, `${table} is excluded without a reason worth reading`).toBeGreaterThan(
        20
      );
    }
  });

  it('names every table exactly once, so nothing is exported twice', () => {
    expect(tableNames).toEqual([...new Set(tableNames)]);
  });

  /* The specific promises, kept as named assertions rather than left to the
     enumeration. These are the ones a person would notice losing. */
  it('carries the planning half of the workspace, not only the Notes half', () => {
    for (const table of [
      'visions',
      'goals',
      'actions',
      'action_templates',
      'action_schedule_history',
      'planning_horizons',
      'reviews',
      'review_action_items',
    ]) {
      expect(tableNames, `${table} is part of what the owner leaves with`).toContain(table);
    }
  });

  it('carries what the life-areas redesign added', () => {
    for (const table of [
      'life_areas',
      'projects',
      'weekly_plans',
      'weekly_plan_items',
      'weekly_plan_snapshots',
    ]) {
      expect(tableNames, `${table} is part of what the owner leaves with`).toContain(table);
    }
  });

  /* Preferences are decisions too, and quieter ones: nobody notices losing
     their week start until a restored week begins on the wrong day and every
     period is keyed differently from the one before it. */
  it('carries the preferences the owner set, without the identity they set them under', () => {
    const workspaces = exportTables.find(([table]) => table === 'workspaces');
    expect(workspaces, 'workspace preferences are part of the export').toBeDefined();
    const columns = String(workspaces?.[1]);
    for (const column of ['timezone', 'week_starts_on', 'weekly_review_day', 'ai_enabled']) {
      expect(columns, `${column} is a decision the owner made`).toContain(column);
    }
    expect(columns, 'Auth identity does not belong in a data export').not.toContain(
      'owner_user_id'
    );
  });

  it('still carries the Notes half, which the vault also covers', () => {
    for (const table of ['notes', 'note_links', 'note_tags', 'tags', 'captures']) {
      expect(tableNames).toContain(table);
    }
  });
});
