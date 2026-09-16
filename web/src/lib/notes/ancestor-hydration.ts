// Bringing a search result's ancestors back with it.
//
// A result is identified by where it is filed. "Notes" means nothing on its
// own; "Clients > Acme > Notes" is unmistakable. So a match filed two levels
// down has to arrive with the Notes that say where that is, or it has no path
// to show and, once opened, no ancestors to name -- which is precisely the case
// a search is for.
//
// The chain is walked a level at a time rather than a Note at a time, so a deep
// vault costs one round trip per level of depth rather than one per ancestor.
// The fetching stays in the Server Action; what is here is the part that
// decides what to fetch next and when to stop, which is the part with something
// to get wrong.

export type HydratableNote = {
  id: string;
  parentNoteId: string | null;
};

/**
 * The parents these Notes point at that are not already held.
 *
 * Deduplicated, because a level of siblings usually shares one parent and
 * asking for it once per sibling would undo the point of walking by level.
 */
export function missingParentIds<T extends HydratableNote>(
  held: ReadonlyMap<string, T>,
  notes: readonly T[]
): string[] {
  return [
    ...new Set(
      notes
        .map((note) => note.parentNoteId)
        .filter((parentId): parentId is string => parentId !== null && !held.has(parentId))
    ),
  ];
}

/**
 * Take a fetched level into the collection and say what the next one is.
 *
 * `held` is mutated, which is what makes the walk terminate: a Note is only
 * ever asked for while it is absent, and absorbing it removes it from every
 * future answer. A cycle in the parent links therefore ends after one lap
 * rather than looping, without needing a separate guard to notice.
 */
export function absorbAncestorLevel<T extends HydratableNote>(
  held: Map<string, T>,
  level: readonly T[]
): string[] {
  for (const note of level) held.set(note.id, note);
  return missingParentIds(held, level);
}

/**
 * Ancestors travel with the results but are not results themselves.
 *
 * Marking them rather than separating them keeps the decision about what to
 * render with the caller: the tree wants both, a result list wants only the
 * matches, and neither has to reconstruct the distinction.
 */
export function markMatches<T extends HydratableNote>(
  held: ReadonlyMap<string, T>,
  matchIds: ReadonlySet<string>
): (T & { matchesQuery: boolean })[] {
  return [...held.values()].map((note) => ({ ...note, matchesQuery: matchIds.has(note.id) }));
}
