import { describe, expect, it, vi } from 'vitest';
import { selectAll, SUPABASE_PAGE_SIZE } from '@/lib/supabase/select-all';

function pagedSource(total: number, pageSize = SUPABASE_PAGE_SIZE) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  return vi.fn(async (from: number, to: number) => ({
    // The cap is the database's, not the caller's: asking for more than a page
    // still returns one page.
    data: rows.slice(from, Math.min(to + 1, from + pageSize)),
    error: null,
  }));
}

describe('reading past the row cap', () => {
  it('returns every row when there are more than one page', async () => {
    const fetchPage = pagedSource(2_500);
    const { data, error } = await selectAll(fetchPage);

    expect(error).toBeNull();
    expect(data).toHaveLength(2_500);
    expect(data.at(-1)).toEqual({ id: 2_499 });
    // Three full pages, then the short one that proves there is no more.
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('stops on a short page without asking again', async () => {
    const fetchPage = pagedSource(10);
    const { data } = await selectAll(fetchPage);

    expect(data).toHaveLength(10);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('asks once more when the last page is exactly full', async () => {
    // A workspace of exactly one page is the case that looks finished and is
    // not distinguishable from a truncated one without asking.
    const fetchPage = pagedSource(SUPABASE_PAGE_SIZE);
    const { data } = await selectAll(fetchPage);

    expect(data).toHaveLength(SUPABASE_PAGE_SIZE);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('reports a failure instead of returning a short answer as if it were whole', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: Array.from({ length: SUPABASE_PAGE_SIZE }), error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('connection lost') });

    const { error } = await selectAll(fetchPage);
    expect(error).toBeInstanceOf(Error);
  });
});
