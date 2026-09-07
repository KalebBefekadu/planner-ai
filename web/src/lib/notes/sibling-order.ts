export type SiblingPosition = { id: string; sortKey: number };

// Moving a Note writes the midpoint between its new neighbours rather than
// renumbering the whole level, so one move updates one row and stays reversible
// through the same Operation that made it.
//
// notes.sort_key is numeric(24, 12). Halving the gap each time means repeated
// moves into the same position eventually exhaust those twelve fractional
// digits, so a gap that can no longer be halved is reported as unavailable
// instead of silently collapsing two Notes onto one key.
export const MIN_SORT_KEY_GAP = 1e-9;

// 'edge' means the Note is already first or last and the direction is simply
// unavailable. 'exhausted' means there is somewhere to go but no key left
// between the neighbours, which a person needs told rather than ignored.
export type SiblingMove =
  | { outcome: 'moved'; sortKey: number }
  | { outcome: 'edge' }
  | { outcome: 'exhausted' };

export function nextSiblingMove(
  siblings: SiblingPosition[],
  id: string,
  direction: 'up' | 'down'
): SiblingMove {
  const order = [...siblings].sort((first, second) => first.sortKey - second.sortKey);
  const index = order.findIndex((sibling) => sibling.id === id);
  if (index < 0) return { outcome: 'edge' };

  const step = direction === 'up' ? -1 : 1;
  const neighbour = order[index + step];
  if (!neighbour) return { outcome: 'edge' };

  const beyond = order[index + step * 2];
  if (!beyond) return { outcome: 'moved', sortKey: neighbour.sortKey + step * 1000 };
  if (Math.abs(beyond.sortKey - neighbour.sortKey) < MIN_SORT_KEY_GAP) {
    return { outcome: 'exhausted' };
  }
  return { outcome: 'moved', sortKey: (neighbour.sortKey + beyond.sortKey) / 2 };
}

export type TreePosition = { id: string; parentNoteId: string | null; sortKey: number };

// Changing a Note's parent, as distinct from its order among its siblings.
//
// The hierarchy is changed by indent and outdent rather than by dragging. A
// drag needs a pointer, a drop target, and a steady hand; indent and outdent
// are two controls that a keyboard and a screen reader can both reach, and
// they say exactly where the Note lands.
export type ParentMove =
  | { outcome: 'moved'; parentNoteId: string | null; sortKey: number }
  | { outcome: 'edge' }
  | { outcome: 'exhausted' };

function childrenOf(notes: TreePosition[], parentNoteId: string | null) {
  return notes
    .filter((note) => note.parentNoteId === parentNoteId)
    .sort((first, second) => first.sortKey - second.sortKey);
}

export function nextParentMove(
  notes: TreePosition[],
  id: string,
  direction: 'indent' | 'outdent'
): ParentMove {
  const note = notes.find((candidate) => candidate.id === id);
  if (!note) return { outcome: 'edge' };
  const siblings = childrenOf(notes, note.parentNoteId);
  const index = siblings.findIndex((sibling) => sibling.id === id);

  if (direction === 'indent') {
    // A Note becomes a child of the Note above it, which is the only move that
    // needs no target picker. The first Note at a level has nothing to go
    // under. This can never form a cycle: an earlier sibling is never a
    // descendant of the Note being moved.
    const newParent = siblings[index - 1];
    if (!newParent) return { outcome: 'edge' };
    const existing = childrenOf(notes, newParent.id);
    const last = existing[existing.length - 1];
    return {
      outcome: 'moved',
      parentNoteId: newParent.id,
      sortKey: last ? last.sortKey + 1000 : 1000,
    };
  }

  // Outdent lifts a Note to sit directly after the parent it is leaving, so it
  // stays next to the material it came from instead of falling to the end.
  if (note.parentNoteId === null) return { outcome: 'edge' };
  const parent = notes.find((candidate) => candidate.id === note.parentNoteId);
  if (!parent) return { outcome: 'edge' };
  const parentSiblings = childrenOf(notes, parent.parentNoteId);
  const parentIndex = parentSiblings.findIndex((sibling) => sibling.id === parent.id);
  const after = parentSiblings[parentIndex + 1];
  if (!after) {
    return { outcome: 'moved', parentNoteId: parent.parentNoteId, sortKey: parent.sortKey + 1000 };
  }
  if (Math.abs(after.sortKey - parent.sortKey) < MIN_SORT_KEY_GAP) {
    return { outcome: 'exhausted' };
  }
  return {
    outcome: 'moved',
    parentNoteId: parent.parentNoteId,
    sortKey: (parent.sortKey + after.sortKey) / 2,
  };
}

// Every Note that sits somewhere beneath this one. Moving a Note under its own
// descendant would detach that whole branch from the tree, so these are the
// destinations that must never be offered.
export function descendantIds(notes: TreePosition[], id: string): Set<string> {
  const found = new Set<string>();
  const visit = (parentNoteId: string) => {
    for (const note of notes) {
      if (note.parentNoteId === parentNoteId && !found.has(note.id)) {
        found.add(note.id);
        visit(note.id);
      }
    }
  };
  visit(id);
  return found;
}

// Where a Note may be filed. Indent and outdent reach the Note above and the
// grandparent; this reaches anywhere else the hierarchy allows, including back
// out to the top level, which is expressed as a null parent.
export function parentCandidateIds(notes: TreePosition[], id: string): string[] {
  const forbidden = descendantIds(notes, id);
  return notes.filter((note) => note.id !== id && !forbidden.has(note.id)).map((note) => note.id);
}

export function placeUnderParent(
  notes: TreePosition[],
  id: string,
  parentNoteId: string | null
): ParentMove {
  const note = notes.find((candidate) => candidate.id === id);
  if (!note) return { outcome: 'edge' };
  // Filing a Note where it already sits is not a move.
  if (note.parentNoteId === parentNoteId) return { outcome: 'edge' };
  if (parentNoteId !== null) {
    if (parentNoteId === id) return { outcome: 'edge' };
    if (!notes.some((candidate) => candidate.id === parentNoteId)) return { outcome: 'edge' };
    if (descendantIds(notes, id).has(parentNoteId)) return { outcome: 'edge' };
  }
  // A Note arriving from elsewhere goes last, where a person will look for what
  // they just moved rather than having it appear in the middle of a level.
  const existing = childrenOf(notes, parentNoteId).filter((child) => child.id !== id);
  const last = existing[existing.length - 1];
  return {
    outcome: 'moved',
    parentNoteId,
    sortKey: last ? last.sortKey + 1000 : 1000,
  };
}
