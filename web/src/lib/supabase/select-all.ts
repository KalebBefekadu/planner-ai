/* PostgREST caps every response at `max_rows` (1000, set in
 * supabase/config.toml). That cap is a sensible safety net against an
 * unbounded read, but it is silent: a query that asks for a whole workspace
 * gets the first thousand rows and no indication that more exist.
 *
 * A workspace-wide read that must be complete -- the Notes tree, and above all
 * the export that is the owner's way out of the product -- has to page through
 * it. A 1400-Note workspace was exporting a vault of 1000 Markdown files with
 * no error, no warning and no count: the backup was quietly short by 400
 * pages.
 *
 * Raising max_rows instead would only move the cliff. */

export const SUPABASE_PAGE_SIZE = 1000;

type Page<Row> = { data: Row[] | null; error: unknown };

/**
 * Read every row a query matches, a page at a time.
 *
 * `fetchPage` must apply a stable order; without one the database is free to
 * return the same row on two pages and drop another entirely.
 */
export async function selectAll<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<Row>>,
  pageSize: number = SUPABASE_PAGE_SIZE
): Promise<{ data: Row[]; error: unknown }> {
  const all: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { data: all, error };
    const rows = data ?? [];
    all.push(...rows);
    // A short page is the last one. A full page means there may be more, and
    // the extra request that comes back empty is the price of being sure.
    if (rows.length < pageSize) break;
  }
  return { data: all, error: null };
}
