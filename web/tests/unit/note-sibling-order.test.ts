import { describe, expect, it } from 'vitest';
import {
  descendantIds,
  nextParentMove,
  nextSiblingMove,
  parentCandidateIds,
  placeUnderParent,
  type SiblingPosition,
  type TreePosition,
} from '@/lib/notes/sibling-order';

const level: SiblingPosition[] = [
  { id: 'a', sortKey: 1000 },
  { id: 'b', sortKey: 2000 },
  { id: 'c', sortKey: 3000 },
];

const moved = (sortKey: number) => ({ outcome: 'moved', sortKey });

describe('Note sibling ordering', () => {
  it('moves a Note between the two Notes it lands among', () => {
    // 'c' rising past 'b' must land between 'a' and 'b'.
    expect(nextSiblingMove(level, 'c', 'up')).toEqual(moved(1500));
    // 'a' falling past 'b' must land between 'b' and 'c'.
    expect(nextSiblingMove(level, 'a', 'down')).toEqual(moved(2500));
  });

  it('moves a Note clear of the edge when it becomes first or last', () => {
    expect(nextSiblingMove(level, 'b', 'up')).toEqual(moved(0));
    expect(nextSiblingMove(level, 'b', 'down')).toEqual(moved(4000));
  });

  it('orders by sort key rather than by the order rows arrive in', () => {
    const shuffled = [level[2], level[0], level[1]];
    expect(nextSiblingMove(shuffled, 'c', 'up')).toEqual(moved(1500));
  });

  // A direction that is unavailable and a gap that has run out are different
  // situations: one is an ordinary edge, the other has to be told to the person.
  it('distinguishes an unavailable direction from a gap that has run out', () => {
    expect(nextSiblingMove(level, 'a', 'up')).toEqual({ outcome: 'edge' });
    expect(nextSiblingMove(level, 'c', 'down')).toEqual({ outcome: 'edge' });
    expect(nextSiblingMove(level, 'missing', 'up')).toEqual({ outcome: 'edge' });
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
    expect(nextSiblingMove([{ id: 'only', sortKey: 1000 }], 'only', 'up')).toEqual({
      outcome: 'edge',
    });
    expect(nextSiblingMove([], 'a', 'down')).toEqual({ outcome: 'edge' });
  });
});

const tree: TreePosition[] = [
  { id: 'first', parentNoteId: null, sortKey: 1000 },
  { id: 'second', parentNoteId: null, sortKey: 2000 },
  { id: 'third', parentNoteId: null, sortKey: 3000 },
  { id: 'first-child', parentNoteId: 'first', sortKey: 1000 },
];

describe('Note parent changes', () => {
  it('indents a Note under the Note above it, after that Note’s own children', () => {
    expect(nextParentMove(tree, 'second', 'indent')).toEqual({
      outcome: 'moved',
      parentNoteId: 'first',
      sortKey: 2000,
    });
  });

  it('indents under an empty parent at the start of that level', () => {
    expect(nextParentMove(tree, 'third', 'indent')).toEqual({
      outcome: 'moved',
      parentNoteId: 'second',
      sortKey: 1000,
    });
  });

  // Outdenting must leave the Note beside the material it came from, not at the
  // end of a level where its context is lost.
  it('outdents a Note to sit directly after the parent it leaves', () => {
    expect(nextParentMove(tree, 'first-child', 'outdent')).toEqual({
      outcome: 'moved',
      parentNoteId: null,
      sortKey: 1500,
    });
  });

  it('outdents past a last parent without needing a gap', () => {
    const lastParent: TreePosition[] = [
      { id: 'only-root', parentNoteId: null, sortKey: 1000 },
      { id: 'child', parentNoteId: 'only-root', sortKey: 1000 },
    ];
    expect(nextParentMove(lastParent, 'child', 'outdent')).toEqual({
      outcome: 'moved',
      parentNoteId: null,
      sortKey: 2000,
    });
  });

  it('reports the directions a Note cannot travel', () => {
    // The first Note at a level has nothing above it to go under.
    expect(nextParentMove(tree, 'first', 'indent')).toEqual({ outcome: 'edge' });
    // A root Note has no parent to leave.
    expect(nextParentMove(tree, 'first', 'outdent')).toEqual({ outcome: 'edge' });
    expect(nextParentMove(tree, 'missing', 'indent')).toEqual({ outcome: 'edge' });
  });

  it('refuses an outdent into a gap too small to divide', () => {
    const exhausted: TreePosition[] = [
      { id: 'parent', parentNoteId: null, sortKey: 1000 },
      { id: 'next', parentNoteId: null, sortKey: 1000.0000000001 },
      { id: 'child', parentNoteId: 'parent', sortKey: 1000 },
    ];
    expect(nextParentMove(exhausted, 'child', 'outdent')).toEqual({ outcome: 'exhausted' });
  });
});

const branch: TreePosition[] = [
  { id: 'root-a', parentNoteId: null, sortKey: 1000 },
  { id: 'root-b', parentNoteId: null, sortKey: 2000 },
  { id: 'child', parentNoteId: 'root-a', sortKey: 1000 },
  { id: 'grandchild', parentNoteId: 'child', sortKey: 1000 },
];

describe('filing a Note under any parent', () => {
  it('finds everything beneath a Note, not just its immediate children', () => {
    expect([...descendantIds(branch, 'root-a')].sort()).toEqual(['child', 'grandchild']);
    expect([...descendantIds(branch, 'grandchild')]).toEqual([]);
  });

  // Filing a Note under its own descendant would tear that branch out of the
  // tree, so those destinations are never offered in the first place.
  it('offers every destination except the Note itself and what hangs beneath it', () => {
    expect(parentCandidateIds(branch, 'root-a').sort()).toEqual(['root-b']);
    expect(parentCandidateIds(branch, 'grandchild').sort()).toEqual(['child', 'root-a', 'root-b']);
  });

  it('files a Note last among its new siblings', () => {
    expect(placeUnderParent(branch, 'grandchild', null)).toEqual({
      outcome: 'moved',
      parentNoteId: null,
      sortKey: 3000,
    });
    expect(placeUnderParent(branch, 'root-b', 'child')).toEqual({
      outcome: 'moved',
      parentNoteId: 'child',
      sortKey: 2000,
    });
  });

  it('files a Note first when its new parent has no children yet', () => {
    expect(placeUnderParent(branch, 'root-b', 'grandchild')).toEqual({
      outcome: 'moved',
      parentNoteId: 'grandchild',
      sortKey: 1000,
    });
  });

  it('refuses a destination that would detach a branch or change nothing', () => {
    expect(placeUnderParent(branch, 'root-a', 'child')).toEqual({ outcome: 'edge' });
    expect(placeUnderParent(branch, 'root-a', 'grandchild')).toEqual({ outcome: 'edge' });
    expect(placeUnderParent(branch, 'root-a', 'root-a')).toEqual({ outcome: 'edge' });
    // Already filed there.
    expect(placeUnderParent(branch, 'child', 'root-a')).toEqual({ outcome: 'edge' });
    expect(placeUnderParent(branch, 'root-a', null)).toEqual({ outcome: 'edge' });
    expect(placeUnderParent(branch, 'missing', null)).toEqual({ outcome: 'edge' });
    expect(placeUnderParent(branch, 'child', 'missing')).toEqual({ outcome: 'edge' });
  });
});
