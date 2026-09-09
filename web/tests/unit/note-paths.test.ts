import { describe, expect, it } from 'vitest';
import { noteAncestors, noteLocationLabel, notePath, orderFavorites } from '@/lib/notes/note-paths';

const tree = [
  { id: 'root', parentNoteId: null, title: 'Clients' },
  { id: 'acme', parentNoteId: 'root', title: 'Acme' },
  { id: 'acme-notes', parentNoteId: 'acme', title: 'Notes' },
  { id: 'globex', parentNoteId: 'root', title: 'Globex' },
  { id: 'globex-notes', parentNoteId: 'globex', title: 'Notes' },
  { id: 'loose', parentNoteId: null, title: 'Scratch' },
];

describe('note ancestors', () => {
  it('reads a deep chain from the root downwards', () => {
    expect(noteAncestors(tree, 'acme-notes').map((note) => note.title)).toEqual([
      'Clients',
      'Acme',
    ]);
  });

  it('gives a root Note no ancestors', () => {
    expect(noteAncestors(tree, 'loose')).toEqual([]);
  });

  it('returns nothing for a Note that is not in the list', () => {
    expect(noteAncestors(tree, 'missing')).toEqual([]);
  });

  /* A search filters the note list down to matches, so a match nested under a
     Note that did not match has a parent id pointing at something absent. The
     walk has to stop there and report the part it can see, not throw. */
  it('stops at the first ancestor it cannot see', () => {
    const partial = [
      { id: 'acme-notes', parentNoteId: 'acme', title: 'Notes' },
      { id: 'loose', parentNoteId: null, title: 'Scratch' },
    ];
    expect(noteAncestors(partial, 'acme-notes')).toEqual([]);
  });

  /* The database forbids a cycle, but a render that hangs is a worse failure
     than a short path, so the walk is bounded regardless of what it is handed. */
  it('does not loop forever on a cycle', () => {
    const cyclic = [
      { id: 'a', parentNoteId: 'b', title: 'A' },
      { id: 'b', parentNoteId: 'a', title: 'B' },
    ];
    expect(noteAncestors(cyclic, 'a').map((note) => note.id)).toEqual(['b']);
  });

  it('never treats a Note as its own ancestor', () => {
    const selfParented = [{ id: 'a', parentNoteId: 'a', title: 'A' }];
    expect(noteAncestors(selfParented, 'a')).toEqual([]);
  });
});

describe('note path', () => {
  it('ends with the Note itself', () => {
    expect(notePath(tree, 'acme-notes').map((note) => note.id)).toEqual([
      'root',
      'acme',
      'acme-notes',
    ]);
  });

  it('is empty for an unknown Note', () => {
    expect(notePath(tree, 'missing')).toEqual([]);
  });
});

describe('note location label', () => {
  /* The point of the label: the two pages are both called "Notes", and only
     their location says which client they belong to. */
  it('tells two identically titled Notes apart', () => {
    expect(noteLocationLabel(tree, 'acme-notes')).toBe('Clients / Acme');
    expect(noteLocationLabel(tree, 'globex-notes')).toBe('Clients / Globex');
  });

  it('adds nothing for a Note at the root', () => {
    expect(noteLocationLabel(tree, 'loose')).toBe('');
  });
});

describe('favourite ordering', () => {
  const favorites = [
    { id: 'third', favoritedAt: '2026-09-03T10:00:00Z' },
    { id: 'first', favoritedAt: '2026-09-01T10:00:00Z' },
    { id: 'not-favorited', favoritedAt: null },
    { id: 'second', favoritedAt: '2026-09-02T10:00:00Z' },
  ];

  it('keeps favourites in the order they were favourited', () => {
    expect(orderFavorites(favorites).map((note) => note.id)).toEqual(['first', 'second', 'third']);
  });

  it('drops anything that is not favourited', () => {
    expect(orderFavorites(favorites).map((note) => note.id)).not.toContain('not-favorited');
  });

  /* Ordering has to be total. Two favourites written in the same transaction
     share a timestamp, and an unstable sort would let them swap places between
     one reload and the next for no reason the person can see. */
  it('breaks a tied timestamp deterministically', () => {
    const tied = [
      { id: 'b', favoritedAt: '2026-09-01T10:00:00Z' },
      { id: 'a', favoritedAt: '2026-09-01T10:00:00Z' },
    ];
    expect(orderFavorites(tied).map((note) => note.id)).toEqual(['a', 'b']);
    expect(orderFavorites([...tied].reverse()).map((note) => note.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the list it is given', () => {
    const original = [...favorites];
    orderFavorites(favorites);
    expect(favorites).toEqual(original);
  });
});
