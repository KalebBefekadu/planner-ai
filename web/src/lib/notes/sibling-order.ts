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

export function nextSiblingSortKey(
  siblings: SiblingPosition[],
  id: string,
  direction: 'up' | 'down'
): number | null {
  const move = nextSiblingMove(siblings, id, direction);
  return move.outcome === 'moved' ? move.sortKey : null;
}
