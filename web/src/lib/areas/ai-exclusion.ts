import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { aiExcludedAreaIds, type AreaRow } from '@/lib/areas/tree';

/* One resolver, used by every path that hands records to a model.
 *
 * Exclusion is inherited: excluding Health excludes Movement beneath it, and
 * an item filed in Movement stays excluded however it is reached -- through
 * search, through a summary, through the record the assistant was pointed at.
 * Two copies of that rule would eventually disagree, and the way anyone would
 * find out is by reading their own excluded writing in a model's reply.
 *
 * This cannot un-send anything already sent to a provider, and nothing here
 * pretends otherwise.
 */

/** Every area id a model must not see work from, ancestors resolved. */
export async function excludedAreaIds(
  supabase: Pick<SupabaseClient, 'from'>,
  workspaceId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('life_areas')
    .select('id,parent_area_id,ai_excluded')
    .eq('workspace_id', workspaceId)
    .limit(1000);
  if (error) throw new Error('Unable to resolve AI exclusions.');
  const rows = (data ?? []).map(
    (row) =>
      ({
        id: row.id as string,
        parentAreaId: (row.parent_area_id as string | null) ?? null,
        aiExcluded: Boolean(row.ai_excluded),
        // The resolver reads only these three; the rest of the shape is not
        // fetched because nothing here needs it.
        name: '',
        icon: null,
        color: null,
        sortKey: 0,
        canonicalNoteId: '',
        version: 1,
        archivedAt: null,
      }) satisfies AreaRow
  );
  return [...aiExcludedAreaIds(rows)];
}

/**
 * The PostgREST filter that keeps excluded work out of a read.
 *
 * `not.in` alone is wrong here: in SQL, `NULL NOT IN (...)` is NULL rather
 * than true, so filtering that way would silently drop every task and page
 * that has no area at all -- which is most of them in a new workspace. The
 * `is.null` half is the whole point.
 */
export function areaExclusionFilter(ids: readonly string[], column = 'primary_area_id') {
  if (!ids.length) return null;
  return `${column}.is.null,${column}.not.in.(${ids.join(',')})`;
}

type Filterable<T> = { or: (filter: string) => T };

/** Apply the filter to a query builder, or leave it alone when nothing is excluded. */
export function withAreaExclusion<T extends Filterable<T>>(
  request: T,
  ids: readonly string[],
  column = 'primary_area_id'
): T {
  const filter = areaExclusionFilter(ids, column);
  return filter ? request.or(filter) : request;
}
