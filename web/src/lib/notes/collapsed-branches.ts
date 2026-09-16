/* Which branches the reader has closed, per browser. This is a view
   preference, not workspace data: it is their own place in their hierarchy and
   does not belong in an Operation or on another device.

   Closed branches are stored rather than open ones, so the default -- an empty
   set -- is a tree that hides nothing. Defaulting the other way meant filing a
   page under another and then returning to Notes found it gone from the tree,
   which reads as data loss rather than as a closed folder.

   Reading `localStorage` is reading an external store, and the server has no
   such store, so `useSyncExternalStore` is what models it honestly: the server
   and hydration both render "nothing open", and the browser's real answer
   arrives once hydration finishes. Restoring in an effect instead sets state
   during a second cascading render, which is also what the lint rule against
   it is protecting.

   Unlike the onboarding draft, this store has a writer -- the disclosure
   controls -- so `subscribe` is real: a write notifies, and every tree
   re-reads. `getSnapshot` must return a stable reference or React re-renders
   forever, so the parsed set is cached against the raw text it came from. */

const NOTE_TREE_COLLAPSED_KEY = 'planner-notes-collapsed';

export const NO_COLLAPSED_NOTES: ReadonlySet<string> = new Set();

let collapsedListeners: (() => void)[] = [];
let collapsedRaw: string | null = null;
let collapsedCache: ReadonlySet<string> = NO_COLLAPSED_NOTES;

export function subscribeToCollapsedNotes(onChange: () => void) {
  collapsedListeners = [...collapsedListeners, onChange];
  return () => {
    collapsedListeners = collapsedListeners.filter((listener) => listener !== onChange);
  };
}

export function collapsedNotesSnapshot(): ReadonlySet<string> {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(NOTE_TREE_COLLAPSED_KEY);
  } catch {
    // Private browsing and locked-down profiles throw on access rather than
    // returning null. Treat that as "nothing remembered".
    return NO_COLLAPSED_NOTES;
  }
  if (raw !== collapsedRaw) {
    collapsedRaw = raw;
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      collapsedCache = new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
    } catch {
      // Text this key cannot describe is not worth failing a page over.
      collapsedCache = NO_COLLAPSED_NOTES;
    }
  }
  return collapsedCache;
}

export function serverCollapsedNotesSnapshot(): ReadonlySet<string> {
  return NO_COLLAPSED_NOTES;
}

export function writeCollapsedNotes(next: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(NOTE_TREE_COLLAPSED_KEY, JSON.stringify([...next]));
  } catch {
    // Not being able to remember the shape of the tree is not a reason to
    // refuse to change it, so notify regardless and let this session hold it.
    collapsedRaw = null;
    collapsedCache = next;
  }
  for (const listener of collapsedListeners) listener();
}
