import { describe, expect, it } from 'vitest';
import {
  aiExcludedAreaIds,
  areaAncestry,
  areaExcludedFromAi,
  areaScopeIds,
  buildAreaTree,
  countDistinct,
  flattenAreaTree,
  sortKeyForPosition,
  visibleAreas,
  type AreaRow,
} from '@/lib/areas/tree';

function area(id: string, parentAreaId: string | null, overrides: Partial<AreaRow> = {}): AreaRow {
  return {
    id,
    parentAreaId,
    name: id,
    icon: null,
    color: null,
    sortKey: 1000,
    canonicalNoteId: `note-${id}`,
    aiExcluded: false,
    version: 1,
    archivedAt: null,
    ...overrides,
  };
}

describe('the shape of a life area tree', () => {
  it('nests children under their parent in sibling order', () => {
    const tree = buildAreaTree([
      area('health', null, { sortKey: 2000 }),
      area('home', null, { sortKey: 1000 }),
      area('sleep', 'health', { sortKey: 2000 }),
      area('movement', 'health', { sortKey: 1000 }),
    ]);
    expect(tree.map((node) => node.id)).toEqual(['home', 'health']);
    expect(tree[1].children.map((node) => node.id)).toEqual(['movement', 'sleep']);
    expect(tree[1].children[0].depth).toBe(1);
  });

  it('breaks ties on id so the order never depends on read order', () => {
    const forward = buildAreaTree([area('b', null), area('a', null)]);
    const backward = buildAreaTree([area('a', null), area('b', null)]);
    expect(forward.map((node) => node.id)).toEqual(backward.map((node) => node.id));
  });

  it('shows an area whose parent is missing from this read rather than losing it', () => {
    const tree = buildAreaTree([area('movement', 'health')]);
    expect(tree.map((node) => node.id)).toEqual(['movement']);
  });

  it('does not hang on a cycle it should never be handed', () => {
    const tree = buildAreaTree([area('a', 'b'), area('b', 'a')]);
    expect(flattenAreaTree(tree).length).toBeLessThanOrEqual(2);
  });
});

describe('what archiving hides', () => {
  const rows = [
    area('health', null, { archivedAt: '2026-09-01T00:00:00Z' }),
    area('movement', 'health'),
    area('sleep', 'health', { archivedAt: '2026-08-01T00:00:00Z' }),
    area('home', null),
  ];

  it('hides the descendants of an archived area without marking them', () => {
    const tree = buildAreaTree(rows);
    expect(visibleAreas(tree).map((node) => node.id)).toEqual(['home']);
    const movement = flattenAreaTree(tree).find((node) => node.id === 'movement');
    expect(movement?.hiddenByAncestor).toBe(true);
    expect(movement?.archivedAt).toBeNull();
  });

  it('restores the subtree with the parent, but not a child archived on its own', () => {
    const restored = rows.map((row) => (row.id === 'health' ? { ...row, archivedAt: null } : row));
    const visible = visibleAreas(buildAreaTree(restored)).map((node) => node.id);
    expect(visible).toContain('movement');
    expect(visible).not.toContain('sleep');
  });
});

describe('what an area page covers', () => {
  const rows = [
    area('health', null),
    area('movement', 'health'),
    area('running', 'movement'),
    area('home', null),
  ];

  it('includes descendants by default', () => {
    expect(areaScopeIds(rows, 'health', 'descendants').sort()).toEqual([
      'health',
      'movement',
      'running',
    ]);
  });

  it('narrows to the area itself when asked', () => {
    expect(areaScopeIds(rows, 'health', 'self')).toEqual(['health']);
  });

  it('counts an item once however many ways it is reachable', () => {
    expect(countDistinct([{ id: 'task-1' }, { id: 'task-1' }, { id: 'task-2' }])).toBe(2);
  });

  it('reads the path from the root for a breadcrumb', () => {
    expect(areaAncestry(rows, 'running').map((row) => row.id)).toEqual([
      'health',
      'movement',
      'running',
    ]);
  });
});

describe('AI exclusion is inherited', () => {
  const rows = [
    area('health', null, { aiExcluded: true }),
    area('movement', 'health'),
    area('home', null),
    area('kitchen', 'home'),
  ];

  it('excludes everything under an excluded area', () => {
    expect(areaExcludedFromAi(rows, 'movement')).toBe(true);
    expect(areaExcludedFromAi(rows, 'kitchen')).toBe(false);
  });

  it('treats work with no area as included', () => {
    expect(areaExcludedFromAi(rows, null)).toBe(false);
  });

  it('resolves the whole excluded set once', () => {
    expect([...aiExcludedAreaIds(rows)].sort()).toEqual(['health', 'movement']);
  });
});

describe('placing a new sibling', () => {
  const siblings = [area('a', null, { sortKey: 1000 }), area('b', null, { sortKey: 2000 })];

  it('lands at the end when nothing is named', () => {
    expect(sortKeyForPosition(siblings, 'b')).toBe(3000);
  });

  it('lands between two when one is named', () => {
    expect(sortKeyForPosition(siblings, 'a')).toBe(1500);
  });

  it('lands first when nothing precedes it', () => {
    expect(sortKeyForPosition(siblings, null)).toBe(0);
  });

  it('starts somewhere sensible in an empty list', () => {
    expect(sortKeyForPosition([], null)).toBe(1000);
  });
});
