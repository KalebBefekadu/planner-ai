// What the Notes tree shows, decided apart from what draws it.
//
// These answers used to live inside the Workspace component, where the only
// way to ask "does an unparented Note offer Outdent?" was to render the whole
// Workspace and look. They are pure functions of the Notes in hand, so they
// belong where they can be asked directly.
//
// Every walk here is bounded the same way [note-paths] bounds its own: a
// parent chain is data, and data can point at a Note that is not in hand or,
// if a cycle ever survived the database's guard, at itself.

import { nextParentMove, nextSiblingMove, parentCandidateIds } from './sibling-order';

export type NoteTreeNode = {
  id: string;
  parentNoteId: string | null;
  sortKey: number;
};

export type NoteMoves = {
  up: boolean;
  down: boolean;
  indent: boolean;
  outdent: boolean;
};

const NO_MOVES: NoteMoves = { up: false, down: false, indent: false, outdent: false };

/**
 * Siblings grouped under their parent, each group in the order the tree draws
 * them. `null` holds the roots.
 */
export function childrenByParent<T extends NoteTreeNode>(notes: T[]): Map<string | null, T[]> {
  const byParent = new Map<string | null, T[]>();
  for (const note of notes) {
    const siblings = byParent.get(note.parentNoteId) ?? [];
    siblings.push(note);
    byParent.set(note.parentNoteId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((first, second) => first.sortKey - second.sortKey);
  }
  return byParent;
}

/**
 * The chain above a Note, so reading a deep page reveals where it lives rather
 * than leaving the tree closed around it. The Note itself is not in the set.
 */
export function ancestorIds(notes: NoteTreeNode[], noteId: string | null): ReadonlySet<string> {
  const chain = new Set<string>();
  if (!noteId) return chain;
  const byId = new Map(notes.map((note) => [note.id, note]));
  let parentId = byId.get(noteId)?.parentNoteId ?? null;
  while (parentId && !chain.has(parentId)) {
    chain.add(parentId);
    parentId = byId.get(parentId)?.parentNoteId ?? null;
  }
  return chain;
}

/**
 * A branch the reader closed stays closed -- unless the page being read lives
 * inside it, in which case hiding it would hide the open page.
 */
export function isBranchExpanded(
  collapsedIds: ReadonlySet<string>,
  ancestorsOfActive: ReadonlySet<string>,
  noteId: string
): boolean {
  return !collapsedIds.has(noteId) || ancestorsOfActive.has(noteId);
}

/**
 * The collapsed set after the reader toggles a branch.
 *
 * An ancestor of the open page is forced open, so the stored set can say a
 * branch is closed while it renders open. Toggling acts on what is on screen,
 * which is the only state the reader can see.
 */
export function toggleBranch(
  collapsedIds: ReadonlySet<string>,
  ancestorsOfActive: ReadonlySet<string>,
  noteId: string
): ReadonlySet<string> {
  const next = new Set(collapsedIds);
  if (isBranchExpanded(collapsedIds, ancestorsOfActive, noteId)) next.add(noteId);
  else next.delete(noteId);
  return next;
}

/**
 * Which moves are open to a Note, decided by the same functions the server
 * uses to perform them. Working it out separately would let the controls offer
 * a move the server then refuses, or hide one it would have allowed.
 */
export function availableNoteMoves(notes: NoteTreeNode[], selectedId: string | null): NoteMoves {
  if (!selectedId) return NO_MOVES;
  const selected = notes.find((note) => note.id === selectedId);
  if (!selected) return NO_MOVES;

  const siblings = notes
    .filter((note) => note.parentNoteId === selected.parentNoteId)
    .map((note) => ({ id: note.id, sortKey: note.sortKey }));
  const tree = notes.map((note) => ({
    id: note.id,
    parentNoteId: note.parentNoteId,
    sortKey: note.sortKey,
  }));
  return {
    up: nextSiblingMove(siblings, selected.id, 'up').outcome !== 'edge',
    down: nextSiblingMove(siblings, selected.id, 'down').outcome !== 'edge',
    indent: nextParentMove(tree, selected.id, 'indent').outcome !== 'edge',
    outdent: nextParentMove(tree, selected.id, 'outdent').outcome !== 'edge',
  };
}

/**
 * Where a Note may be filed: anywhere that would not put it inside itself, and
 * not the parent it already has, which would be offering a move that changes
 * nothing.
 */
export function filingCandidates<T extends NoteTreeNode>(notes: T[], selectedId: string | null) {
  if (!selectedId) return [];
  const selected = notes.find((note) => note.id === selectedId);
  if (!selected) return [];
  const tree = notes.map((note) => ({
    id: note.id,
    parentNoteId: note.parentNoteId,
    sortKey: note.sortKey,
  }));
  const allowed = new Set(parentCandidateIds(tree, selected.id));
  return notes.filter((note) => allowed.has(note.id) && note.id !== selected.parentNoteId);
}
