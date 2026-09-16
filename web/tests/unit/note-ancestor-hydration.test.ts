import { describe, expect, it } from 'vitest';
import { absorbAncestorLevel, markMatches, missingParentIds } from '@/lib/notes/ancestor-hydration';

/* Searching narrows the Note list to matches, so a match filed two levels down
   arrives with a parent id pointing at something the query did not return. The
   walk that fetches those ancestors ran inside `getNotes`, interleaved with the
   round trips, so whether it terminates was a property nobody could check
   without a vault to search. */

const note = (id: string, parentNoteId: string | null = null) => ({ id, parentNoteId });

describe('what still has to be fetched', () => {
  it('asks for a parent that is not held', () => {
    const held = new Map([['child', note('child', 'parent')]]);
    expect(missingParentIds(held, [note('child', 'parent')])).toEqual(['parent']);
  });

  /* A level of siblings usually shares one parent, and asking for it once per
     sibling would undo the point of walking by level. */
  it('asks for a shared parent once, not once per child', () => {
    const children = [note('a', 'shared'), note('b', 'shared'), note('c', 'shared')];
    expect(missingParentIds(new Map(), children)).toEqual(['shared']);
  });

  it('does not ask for a parent that is already a match', () => {
    const held = new Map([
      ['parent', note('parent')],
      ['child', note('child', 'parent')],
    ]);
    expect(missingParentIds(held, [note('child', 'parent')])).toEqual([]);
  });

  it('has nothing to ask for when every match is a root', () => {
    expect(missingParentIds(new Map(), [note('a'), note('b')])).toEqual([]);
  });
});

describe('taking a level in', () => {
  it('adds the level and reports the one above it', () => {
    const held = new Map([['child', note('child', 'parent')]]);
    const next = absorbAncestorLevel(held, [note('parent', 'grandparent')]);
    expect(next).toEqual(['grandparent']);
    expect(held.has('parent')).toBe(true);
  });

  it('stops when the level it took has no parents left', () => {
    const held = new Map([['child', note('child', 'root')]]);
    expect(absorbAncestorLevel(held, [note('root', null)])).toEqual([]);
  });

  /* The walk terminates because a Note is only ever asked for while it is
     absent, and absorbing it removes it from every future answer. A cycle in
     the parent links therefore ends after one lap rather than looping, with no
     separate guard needed to notice -- which is the property worth pinning,
     because the loop it protects is a `while` around a network call. */
  it('ends a cycle after one lap instead of looping forever', () => {
    const held = new Map([['a', note('a', 'b')]]);
    const afterB = absorbAncestorLevel(held, [note('b', 'a')]);
    expect(afterB).toEqual([]);
    expect([...held.keys()].sort()).toEqual(['a', 'b']);
  });

  it('ends a longer cycle the same way', () => {
    const held = new Map([['a', note('a', 'b')]]);
    expect(absorbAncestorLevel(held, [note('b', 'c')])).toEqual(['c']);
    expect(absorbAncestorLevel(held, [note('c', 'a')])).toEqual([]);
  });
});

describe('marking what actually matched', () => {
  /* The tree wants the ancestors, a result list wants only the matches, and
     neither should have to reconstruct the distinction. */
  it('marks matches and leaves hydrated ancestors unmarked', () => {
    const held = new Map([
      ['root', note('root')],
      ['match', note('match', 'root')],
    ]);
    const marked = markMatches(held, new Set(['match']));
    expect(marked).toEqual([
      { id: 'root', parentNoteId: null, matchesQuery: false },
      { id: 'match', parentNoteId: 'root', matchesQuery: true },
    ]);
  });

  it('keeps the order the collection was built in, ancestors last', () => {
    const held = new Map([
      ['match', note('match', 'root')],
      ['root', note('root')],
    ]);
    expect(markMatches(held, new Set(['match'])).map((n) => n.id)).toEqual(['match', 'root']);
  });

  it('does not mutate what it was given', () => {
    const original = note('a');
    const held = new Map([['a', original]]);
    markMatches(held, new Set(['a']));
    expect(original).not.toHaveProperty('matchesQuery');
  });
});
