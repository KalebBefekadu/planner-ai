// An unsaved Note draft is the only copy of something a person wrote. When a
// save is refused -- a conflict, an expired session, a network that went away
// -- keeping it in React state alone means a reload throws the writing away
// at exactly the moment it mattered most.
//
// This is deliberately not offline sync. It is a short-lived local copy of one
// rejected draft, held so the words survive a reload and can be put back into
// the editor by the person who wrote them.

const PREFIX = 'planner-note-draft:';

// Reading local storage during render would disagree with the server, which
// has no storage to read, so the draft is exposed as an external store: the
// server snapshot is always "no draft" and the client fills it in after
// hydration. The cache keeps snapshot identity stable, which the store
// contract requires.
const listeners = new Set<() => void>();
const snapshots = new Map<string, StoredNoteDraft | null>();

function announce() {
  snapshots.clear();
  for (const listener of listeners) listener();
}

export function subscribeToNoteDrafts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stable-identity snapshot of one Note's stored draft, for useSyncExternalStore. */
export function noteDraftSnapshot(noteId: string): StoredNoteDraft | null {
  if (!snapshots.has(noteId)) snapshots.set(noteId, recallNoteDraft(noteId));
  return snapshots.get(noteId) ?? null;
}

/**
 * How long a rejected draft is kept.
 *
 * Long enough to survive a reload, a restart, or a night's sleep before coming
 * back to it. Not so long that a draft abandoned weeks ago resurfaces as a
 * surprise over a Note that has moved on since.
 */
export const DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type StoredNoteDraft = {
  noteId: string;
  title: string;
  bodyMarkdown: string;
  savedAt: number;
  /** The version the rejected save was written against. */
  expectedVersion: number;
};

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Private windows and blocked site data throw on access rather than
    // returning null, and losing a draft is better than breaking the editor.
    return null;
  }
}

export function rememberNoteDraft(draft: StoredNoteDraft) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(`${PREFIX}${draft.noteId}`, JSON.stringify(draft));
  } catch {
    // A full quota is not worth an error in the editor.
  }
  announce();
}

export function forgetNoteDraft(noteId: string) {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(`${PREFIX}${noteId}`);
  } catch {
    // Nothing useful to do.
  }
  announce();
}

/**
 * The stored draft for a Note, if there is one worth offering.
 *
 * An expired draft is dropped rather than returned, so the retention policy is
 * enforced on read and does not depend on anything running in the background.
 */
export function recallNoteDraft(noteId: string, now = Date.now()): StoredNoteDraft | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(`${PREFIX}${noteId}`);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    forgetNoteDraft(noteId);
    return null;
  }
  const draft = parsed as Partial<StoredNoteDraft> | null;
  if (
    !draft ||
    draft.noteId !== noteId ||
    typeof draft.title !== 'string' ||
    typeof draft.bodyMarkdown !== 'string' ||
    typeof draft.savedAt !== 'number' ||
    typeof draft.expectedVersion !== 'number'
  ) {
    forgetNoteDraft(noteId);
    return null;
  }
  if (now - draft.savedAt > DRAFT_RETENTION_MS) {
    forgetNoteDraft(noteId);
    return null;
  }
  return draft as StoredNoteDraft;
}
