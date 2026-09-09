// Where a Note sits is as much a part of its identity as its title. Two pages
// called "Notes" mean nothing on their own; "Clients > Acme > Notes" and
// "Clients > Globex > Notes" are unmistakable. Both the breadcrumb above an
// open Note and a search result need that same answer, so it is derived once
// here rather than reconstructed in each surface.

export type NotePathNode = {
  id: string;
  parentNoteId: string | null;
  title: string;
};

export type NoteFavorite = {
  id: string;
  favoritedAt: string | null;
};

// A parent chain is data, and data from a database that has been reparented,
// partially loaded, or filtered by a search query can point at a Note that is
// not in hand -- or, if a cycle ever survived the database's own guard, at
// itself. Walking it without a bound would hang the render, so the walk stops
// at the first id it has already seen and returns what it has.
export function noteAncestors<T extends NotePathNode>(notes: T[], noteId: string): T[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const start = byId.get(noteId);
  if (!start) return [];

  const chain: T[] = [];
  const seen = new Set<string>([noteId]);
  let parentId = start.parentNoteId;
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    seen.add(parent.id);
    chain.push(parent);
    parentId = parent.parentNoteId;
  }
  return chain.reverse();
}

// Root first, the Note itself last, matching how the breadcrumb reads.
export function notePath<T extends NotePathNode>(notes: T[], noteId: string): T[] {
  const note = notes.find((candidate) => candidate.id === noteId);
  if (!note) return [];
  return [...noteAncestors(notes, noteId), note];
}

// The label a search result carries so duplicate titles can be told apart. The
// Note's own title is excluded because the result already shows it; an
// unparented Note has no context to add and gets an empty string rather than a
// stray separator.
export function noteLocationLabel(notes: NotePathNode[], noteId: string, separator = ' / ') {
  return noteAncestors(notes, noteId)
    .map((note) => note.title)
    .join(separator);
}

// Favourites are ordered by when they were favourited, oldest first, so the
// list a person builds up stays in the order they built it and does not
// reshuffle every time a Note is edited. The timestamp is the persisted
// ordering; id breaks the tie if two land in the same transaction.
export function orderFavorites<T extends NoteFavorite>(notes: T[]): T[] {
  return notes
    .filter((note) => note.favoritedAt !== null)
    .sort((first, second) => {
      const byTime = (first.favoritedAt ?? '').localeCompare(second.favoritedAt ?? '');
      return byTime !== 0 ? byTime : first.id.localeCompare(second.id);
    });
}
