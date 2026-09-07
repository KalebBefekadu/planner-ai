import { describe, expect, it } from 'vitest';
import {
  nextSiblingMove,
  nextSiblingSortKey,
  type SiblingPosition,
} from '@/lib/notes/sibling-order';

const level: SiblingPosition[] = [
  { id: 'a', sortKey: 1000 },
  { id: 'b', sortKey: 2000 },
  { id: 'c', sortKey: 3000 },
];

describe('Note sibling ordering', () => {
  it('moves a Note between the two Notes it lands among', () => {
    // 'c' rising past 'b' must land between 'a' and 'b'.
    expect(nextSiblingSortKey(level, 'c', 'up')).toBe(1500);
    // 'a' falling past 'b' must land between 'b' and 'c'.
    expect(nextSiblingSortKey(level, 'a', 'down')).toBe(2500);
  });

  it('moves a Note clear of the edge when it becomes first or last', () => {
    expect(nextSiblingSortKey(level, 'b', 'up')).toBe(0);
    expect(nextSiblingSortKey(level, 'b', 'down')).toBe(4000);
  });

  it('reports no move for a Note already at the edge of its level', () => {
    expect(nextSiblingSortKey(level, 'a', 'up')).toBeNull();
    expect(nextSiblingSortKey(level, 'c', 'down')).toBeNull();
  });

  it('reports no move for a Note that is not in the level', () => {
    expect(nextSiblingSortKey(level, 'missing', 'up')).toBeNull();
  });

  it('orders by sort key rather than by the order rows arrive in', () => {
    const shuffled = [level[2], level[0], level[1]];
    expect(nextSiblingSortKey(shuffled, 'c', 'up')).toBe(1500);
  });

  // sort_key is numeric(24, 12), so halving a gap forever would eventually
  // round two Notes onto the same key and make their order arbitrary.
  it('refuses a move into a gap too small to divide', () => {
    const exhausted: SiblingPosition[] = [
      { id: 'a', sortKey: 1000 },
      { id: 'b', sortKey: 1000.0000000001 },
      { id: 'c', sortKey: 3000 },
    ];
    expect(nextSiblingSortKey(exhausted, 'c', 'up')).toBeNull();
  });

  // A direction that is unavailable and a gap that has run out are different
  // situations: one is an ordinary edge, the other has to be told to the person.
  it('distinguishes an unavailable direction from a gap that has run out', () => {
    expect(nextSiblingMove(level, 'a', 'up')).toEqual({ outcome: 'edge' });
    expect(nextSiblingMove(level, 'c', 'up')).toEqual({ outcome: 'moved', sortKey: 1500 });
    expect(
      nextSiblingMove(
        [
          { id: 'a', sortKey: 1000 },
          { id: 'b', sortKey: 1000.0000000001 },
          { id: 'c', sortKey: 3000 },
        ],
        'c',
        'up'
      )
    ).toEqual({ outcome: 'exhausted' });
  });

  it('keeps a single Note and an empty level from claiming a move', () => {
    expect(nextSiblingSortKey([{ id: 'only', sortKey: 1000 }], 'only', 'up')).toBeNull();
    expect(nextSiblingSortKey([], 'a', 'down')).toBeNull();
  });
});
