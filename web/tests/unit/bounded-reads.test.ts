import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/* PostgREST caps every response at max_rows (1000, in supabase/config.toml)
 * and says nothing when it does. A read that asks for a whole workspace and
 * assumes it got everything is therefore a silent-truncation bug waiting for
 * the workspace to grow: the Notes tree showed 1000 of 2500 pages, and the
 * export the owner is meant to leave with contained 1000 of 1400.
 *
 * So every read either carries a bound -- .limit, .range, .single,
 * .maybeSingle, a head count -- or goes through selectAll, or is listed below
 * with the reason it cannot reach the cap. The list is the point: it turns
 * "nobody thought about it" into "someone decided". */

const ALLOWED = new Map<string, string>([
  // Filtered to one parent whose own size is bounded.
  ['src/app/notes/actions.ts::note_attachments', 'the attachments of a single Note'],
  ['src/app/notes/actions.ts::tags', 'in(id, tagIds), from one Note'],
  ['src/app/notes/actions.ts::notes', 'the tree read is paged; the other is in(id, ancestors)'],
  ['src/app/today/actions.ts::daily_focus_items', "one day's focus list"],
  ['src/app/inbox/actions.ts::ai_proposals', 'in(batch_id, batchIds), from a bounded batch list'],
  ['src/app/review/actions.ts::actions', "one week's planning horizon"],
  ['src/app/actions.ts::action_templates', 'recurring templates, a hand-sized set'],
  [
    'src/app/api/note-import/route.ts::note_import_items',
    'one job, capped at IMPORT_LIMITS.candidates (500)',
  ],
  ['src/app/api/note-import/route.ts::note_import_jobs', 'limit(options.limit + 1), paged already'],

  // The legacy planning path, which only runs when PLANNER_DATA_MODEL is not
  // canonical and is being retired. Changing a dying path is risk without
  // value.
  ['src/app/actions.ts::yearly_goals', 'legacy planning path, being retired'],
  ['src/app/actions.ts::quarterly_goals', 'legacy planning path, being retired'],
  ['src/app/actions.ts::monthly_tasks', 'legacy planning path, being retired'],
  ['src/app/actions.ts::weekly_actions', 'legacy planning path, being retired'],

  // Known and tracked in #238 rather than fixed here: a settings list that
  // stops at a thousand is visible rather than silent.
  ['src/app/settings/ai/page.tsx::ai_usage_events', 'tracked in #238'],
  ['src/app/settings/mcp/page.tsx::mcp_access_tokens', 'tracked in #238'],
  ['src/app/settings/mcp/page.tsx::mcp_oauth_grants', 'tracked in #238'],
  ['src/app/settings/memory/page.tsx::memories', 'tracked in #238'],
  ['src/app/conversations/actions.ts::conversation_messages', 'tracked in #238'],
]);

const BOUNDS = ['.limit(', '.range(', '.single()', '.maybeSingle()', 'head: true'];

function sourceFiles(dir: string) {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((entry) => join(dir, entry))
    .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'));
}

describe('reads that must not be silently truncated', () => {
  it('bounds, pages, or explains every table read', () => {
    const unexplained: string[] = [];

    for (const file of sourceFiles('src')) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\.from\('(\w+)'\)/g)) {
        const index = match.index ?? 0;
        // selectAll wraps the builder, so it sits before the .from it pages.
        const before = text.slice(Math.max(0, index - 400), index);
        const after = text.slice(index, index + 900);
        if (!after.includes('.select(')) continue;
        if (before.includes('selectAll(')) continue;
        if (BOUNDS.some((bound) => after.includes(bound))) continue;

        const key = `${file.split('\\').join('/')}::${match[1]}`;
        if (!ALLOWED.has(key)) unexplained.push(key);
      }
    }

    expect(
      [...new Set(unexplained)].sort(),
      'a workspace read with no bound, no paging and no recorded reason'
    ).toEqual([]);
  });

  it('keeps the allowlist honest by failing on an entry that no longer applies', () => {
    // An allowlist nobody prunes becomes a list of things that used to be
    // true. Every entry must still name a real, still-unbounded read.
    const present = new Set<string>();
    for (const file of sourceFiles('src')) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\.from\('(\w+)'\)/g)) {
        present.add(`${file.split('\\').join('/')}::${match[1]}`);
      }
    }

    const stale = [...ALLOWED.keys()].filter((key) => !present.has(key));
    expect(stale, 'the allowlist names a read that is gone').toEqual([]);
  });
});
