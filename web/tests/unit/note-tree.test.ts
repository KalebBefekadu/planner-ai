import { describe, expect, it } from 'vitest';
import {
  ancestorIds,
  availableNoteMoves,
  childrenByParent,
  filingCandidates,
  isBranchExpanded,
  toggleBranch,
} from '@/lib/notes/note-tree';

// Deliberately out of order, because the tree draws by sort key and not by the
// order the database happened to return.
const tree = [
  { id: 'globex', parentNoteId: 'clients', sortKey: 2000 },
  { id: 'clients', parentNoteId: null, sortKey: 1000 },
  { id: 'acme-notes', parentNoteId: 'acme', sortKey: 1000 },
  { id: 'acme', parentNoteId: 'clients', sortKey: 1000 },
  { id: 'scratch', parentNoteId: null, sortKey: 2000 },
];

describe('grouping children', () => {
  it('puts the roots under null and orders every group by sort key', () => {
    const groups = childrenByParent(tree);
    expect(groups.get(null)?.map((note) => note.id)).toEqual(['clients', 'scratch']);
    expect(groups.get('clients')?.map((note) => note.id)).toEqual(['acme', 'globex']);
  });

  it('gives a leaf no group at all rather than an empty one', () => {
    expect(childrenByParent(tree).has('acme-notes')).toBe(false);
  });
});

describe('ancestors of the open page', () => {
  it('names every branch between the page and the root', () => {
    expect([...ancestorIds(tree, 'acme-notes')]).toEqual(['acme', 'clients']);
  });

  it('excludes the page itself, which is not a branch to be held open', () => {
    expect(ancestorIds(tree, 'acme-notes').has('acme-notes')).toBe(false);
  });

  it('has nothing to open when no page is active', () => {
    expect([...ancestorIds(tree, null)]).toEqual([]);
  });

  /* A parent chain is data. A search filters the list down to matches, so a
     match nested under a Note that did not match points at something absent;
     the walk has to stop rather than follow a dangling id. */
  it('stops at a parent that is not in the list', () => {
    const filtered = [{ id: 'acme-notes', parentNoteId: 'acme', sortKey: 1000 }];
    expect([...ancestorIds(filtered, 'acme-notes')]).toEqual(['acme']);
  });

  /* If a cycle ever survived the database's own guard, an unbounded walk would
     hang the render rather than draw a wrong tree. */
  it('terminates on a cycle instead of hanging', () => {
    const cyclic = [
      { id: 'a', parentNoteId: 'b', sortKey: 1000 },
      { id: 'b', parentNoteId: 'a', sortKey: 1000 },
    ];
    expect([...ancestorIds(cyclic, 'a')].sort()).toEqual(['a', 'b']);
  });
});

describe('which branches render open', () => {
  const ancestors = ancestorIds(tree, 'acme-notes');

  it('opens a branch nobody closed', () => {
    expect(isBranchExpanded(new Set(), ancestors, 'scratch')).toBe(true);
  });

  it('keeps a branch the reader closed shut', () => {
    expect(isBranchExpanded(new Set(['scratch']), ancestors, 'scratch')).toBe(false);
  });

  /* Hiding the branch the open page lives in reads as the page having been
     lost, which is what closing a folder must never look like. */
  it('forces open a closed branch that contains the page being read', () => {
    expect(isBranchExpanded(new Set(['acme']), ancestors, 'acme')).toBe(true);
  });
});

describe('toggling a branch', () => {
  const ancestors = ancestorIds(tree, 'acme-notes');

  it('closes an open branch', () => {
    expect([...toggleBranch(new Set(), ancestors, 'scratch')]).toEqual(['scratch']);
  });

  it('opens a closed branch', () => {
    expect([...toggleBranch(new Set(['scratch']), ancestors, 'scratch')]).toEqual([]);
  });

  /* The stored set can say a branch is closed while it renders open, because
     it holds the page being read. Toggling acts on what is on screen: the
     reader sees an open branch, so one click closes it. Acting on the stored
     value instead would need two clicks and look like the first did nothing. */
  it('closes a forced-open ancestor in one step, not two', () => {
    const next = toggleBranch(new Set(['acme']), ancestors, 'acme');
    expect(next.has('acme')).toBe(true);
  });

  it('does not mutate the set it was given', () => {
    const collapsed = new Set(['scratch']);
    toggleBranch(collapsed, ancestors, 'clients');
    expect([...collapsed]).toEqual(['scratch']);
  });
});

describe('which moves the controls may offer', () => {
  it('offers nothing when no Note is open', () => {
    expect(availableNoteMoves(tree, null)).toEqual({
      up: false,
      down: false,
      indent: false,
      outdent: false,
    });
  });

  it('refuses to move the first sibling up or an unparented Note out', () => {
    expect(availableNoteMoves(tree, 'clients')).toMatchObject({ up: false, outdent: false });
  });

  it('lets a later sibling move up and under the one above it', () => {
    expect(availableNoteMoves(tree, 'globex')).toMatchObject({ up: true, indent: true });
  });

  it('lets a nested Note move out to its grandparent', () => {
    expect(availableNoteMoves(tree, 'acme-notes')).toMatchObject({ outdent: true });
  });

  it('offers nothing for a Note that is not in the list', () => {
    expect(availableNoteMoves(tree, 'missing')).toMatchObject({ up: false, down: false });
  });
});

describe('where a Note may be filed', () => {
  it('never offers the Note itself or anything inside it', () => {
    const ids = filingCandidates(tree, 'clients').map((note) => note.id);
    expect(ids).not.toContain('clients');
    expect(ids).not.toContain('acme');
    expect(ids).not.toContain('acme-notes');
  });

  /* Filing a Note under the parent it already has changes nothing, so offering
     it is offering a move that cannot do anything. */
  it('omits the parent the Note already has', () => {
    expect(filingCandidates(tree, 'acme-notes').map((note) => note.id)).not.toContain('acme');
  });

  it('offers a sibling branch', () => {
    expect(filingCandidates(tree, 'acme-notes').map((note) => note.id)).toContain('globex');
  });

  it('offers nothing when no Note is open', () => {
    expect(filingCandidates(tree, null)).toEqual([]);
  });
});
