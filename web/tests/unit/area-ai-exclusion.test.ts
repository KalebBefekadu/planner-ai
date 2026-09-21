import { describe, expect, it } from 'vitest';
import { areaExclusionFilter, excludedAreaIds, withAreaExclusion } from '@/lib/areas/ai-exclusion';

type Row = { id: string; parent_area_id: string | null; ai_excluded: boolean };

function client(rows: Row[], error: { message: string } | null = null) {
  return {
    from() {
      const query = {
        select: () => query,
        eq: () => query,
        limit: () => Promise.resolve({ data: error ? null : rows, error }),
      };
      return query;
    },
  } as never;
}

describe('resolving which areas a model must not see', () => {
  it('carries exclusion down to descendants', async () => {
    const ids = await excludedAreaIds(
      client([
        { id: 'health', parent_area_id: null, ai_excluded: true },
        { id: 'movement', parent_area_id: 'health', ai_excluded: false },
        { id: 'home', parent_area_id: null, ai_excluded: false },
      ]),
      'workspace'
    );
    expect(ids.sort()).toEqual(['health', 'movement']);
  });

  it('fails closed rather than resolving an empty exclusion set', async () => {
    await expect(excludedAreaIds(client([], { message: 'down' }), 'workspace')).rejects.toThrow(
      'Unable to resolve AI exclusions.'
    );
  });
});

describe('the filter that keeps excluded work out of a read', () => {
  /* The case that makes this worth a test: `NULL NOT IN (...)` is NULL, not
     true, so a bare `not.in` would drop every record filed nowhere -- which is
     most of them in a new workspace. */
  it('keeps work that belongs to no area at all', () => {
    expect(areaExclusionFilter(['a', 'b'])).toBe(
      'primary_area_id.is.null,primary_area_id.not.in.(a,b)'
    );
  });

  it('filters a named column when a read uses one', () => {
    expect(areaExclusionFilter(['a'], 'area_id')).toBe('area_id.is.null,area_id.not.in.(a)');
  });

  it('leaves a query untouched when nothing is excluded', () => {
    expect(areaExclusionFilter([])).toBeNull();
    const request = { or: () => ({ or: () => request, touched: true }) };
    expect(withAreaExclusion(request as never, [])).toBe(request);
  });

  it('applies the filter when something is excluded', () => {
    const applied: string[] = [];
    const request = {
      or(filter: string) {
        applied.push(filter);
        return request;
      },
    };
    withAreaExclusion(request as never, ['a']);
    expect(applied).toEqual(['primary_area_id.is.null,primary_area_id.not.in.(a)']);
  });
});
