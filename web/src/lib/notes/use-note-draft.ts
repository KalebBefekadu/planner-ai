'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';

import { getStoredNote, updateNote } from '@/app/notes/actions';
import { operationFailureCode } from '@/lib/operations';
import { actionFailureMessage } from '@/lib/operations/failure-message';
import {
  forgetNoteDraft,
  noteDraftSnapshot,
  rememberNoteDraft,
  subscribeToNoteDrafts,
} from '@/lib/note-draft-recovery';
import { resolveWith, type ConflictSide } from '@/lib/notes/conflict-resolution';

export type NoteDraft = { title: string; bodyMarkdown: string };
export type NoteSaveState = 'saved' | 'unsaved' | 'saving' | 'error';

const AUTOSAVE_DELAY_MS = 800;

function errorMessage(error: unknown) {
  return actionFailureMessage(error, 'Unable to save this Note.');
}

/* Everything the Note editor owes the server, and the states that owing can be
   in: typed but not yet sent, sent and awaiting a response, refused and held
   locally, or in conflict with a version somebody else saved.
 *
 * This lived inline in `notes-workspace.tsx`, interleaved with the tree, the
 * attachments and the knowledge panel, where six refs coordinating one save
 * pipeline were impossible to read as a unit -- and where two edit-losing
 * defects hid long enough to ship. Pulled out, the pipeline is one object with
 * one job, and it can be tested without rendering a workspace.
 */
export function useNoteDraft({
  noteId,
  initial,
  initialVersion,
  serverVersion,
  onError,
}: {
  noteId: string | null;
  initial: NoteDraft;
  initialVersion: number;
  /* What the latest render says the server holds. A save elsewhere on this
     Note -- a move, a rename, restoring a revision -- advances the version
     without going through this pipeline, and the next save from here has to
     write against that, not against the version this hook started with. */
  serverVersion?: number;
  onError: (message: string) => void;
}) {
  const router = useRouter();

  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.bodyMarkdown);
  const [saveState, setSaveState] = useState<NoteSaveState>('saved');
  const [dismissedDraftFor, setDismissedDraftFor] = useState<string | null>(null);

  const versionRef = useRef(initialVersion);
  const persistedDraftRef = useRef<NoteDraft>(initial);
  /* The save currently in flight, held as the promise itself rather than a
     flag. A caller that must not let the page be torn down mid-save -- search
     submitting a document load, say -- needs something to await, not just the
     knowledge that something is happening. */
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const queuedDraftRef = useRef<NoteDraft | null>(null);
  // The autosave pipeline is bound to the Note it belongs to. Switching Notes
  // used to clear the pending timer and drop whatever had been typed in the
  // last 800ms, and the draft had no way of naming which Note it came from.
  const pendingSaveRef = useRef<{ noteId: string; draft: NoteDraft } | null>(null);

  /* Both sides of a refused save, held so the two versions can be compared.
     Separate from `body`/`title`, which stay exactly as typed -- the editor is
     never quietly rewritten out from under someone.

     The stored side is captured here rather than read from `notes` when the
     panel renders. `router.refresh()` is a request for a new render, not a
     fact: the props can still describe the version the draft was written
     against when someone reads the comparison and chooses. That showed a
     person their own pre-conflict text as "the saved version", and then wrote
     back with its version number, which the server refused a second time --
     so the panel stayed up and taking the stored version could not complete
     at all. Capturing the stored side once, at the conflict, makes what is
     compared and what is written the same version that caused the refusal. */
  const [conflict, setConflict] = useState<{
    mine: NoteDraft;
    theirs: NoteDraft & { version: number };
  } | null>(null);

  // A draft left behind by a refused save. Read through the store rather than
  // mirrored into state, so the server and the first client render agree that
  // there is nothing to offer until storage has actually been read.
  const storedDraft = useSyncExternalStore(
    subscribeToNoteDrafts,
    () => (noteId ? noteDraftSnapshot(noteId) : null),
    () => null
  );
  const recoverableDraft =
    storedDraft &&
    storedDraft.noteId === noteId &&
    storedDraft.bodyMarkdown !== body &&
    dismissedDraftFor !== noteId
      ? storedDraft
      : null;

  /* Read the version the server actually holds and put both sides on screen.
     Returns whether the comparison could be built: a Note that has since been
     archived or deleted has no stored side to offer, and saying so honestly is
     better than showing a comparison against nothing. */
  const captureConflict = useCallback(async (id: string, mine: NoteDraft) => {
    try {
      const stored = await getStoredNote(id);
      if (!stored) return false;
      setConflict({
        mine,
        theirs: {
          title: stored.title,
          bodyMarkdown: stored.bodyMarkdown,
          version: stored.version,
        },
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  /* The Note being saved is passed in rather than read from the closure. The
     save that matters most is the one for the Note a person has just left, and
     by then the active Note id already names a different Note.

     Resolves to whether everything queued reached the server. A caller that is
     about to tear the page down needs that answer: navigating away from words
     that were refused is the loss the whole pipeline exists to prevent. */
  const queueAutosave = useCallback(
    (id: string, draft: NoteDraft): Promise<boolean> => {
      queuedDraftRef.current = draft;
      const inFlight = saveInFlightRef.current;
      if (inFlight) return inFlight;

      /* The drain loop re-arms the handle with its own promise, which it
         cannot name from inside its own initialiser. A holder gives it one
         reference that is filled in before any await can reach it. */
      const handle: { promise: Promise<boolean> | null } = { promise: null };
      const work: Promise<boolean> = (async () => {
        setSaveState('saving');
        try {
          /* The inner loop stops when the queue is empty; the handle clears a
             moment later. A draft handed over in between is queued by a caller
             that sees a save still in flight, and then waited for by a loop that
             has already finished -- so it is never written.

             That window is exactly when leaving a Note flushes its pending edit,
             while the debounced save of the keystroke before it may still be
             settling. The last thing typed is therefore the most likely thing to
             fall into it, which is the one edit a person would notice losing.

             Clearing the handle and re-reading the queue with no `await` between
             them closes it: nothing else can run in that gap, so a draft is
             either seen here or arrives to find the handle already empty and
             starts its own save. */
          for (;;) {
            while (queuedDraftRef.current) {
              const nextDraft = queuedDraftRef.current;
              queuedDraftRef.current = null;
              try {
                const saved = await updateNote({
                  id,
                  title: nextDraft.title.trim() || 'Untitled',
                  bodyMarkdown: nextDraft.bodyMarkdown,
                  expectedVersion: versionRef.current,
                });
                versionRef.current = saved.version;
                persistedDraftRef.current = nextDraft;
                // An older save completing must not clear a newer edit that is
                // still waiting for its timer -- that edit has not been written.
                if (pendingSaveRef.current?.draft === nextDraft) pendingSaveRef.current = null;
                forgetNoteDraft(id);
              } catch (caught) {
                queuedDraftRef.current ??= nextDraft;
                // A refused save is the moment the words are least safe: they
                // exist only in this tab. Keep a local copy so a reload, a crash
                // or a closed laptop does not take them with it.
                rememberNoteDraft({
                  noteId: id,
                  title: nextDraft.title,
                  bodyMarkdown: nextDraft.bodyMarkdown,
                  savedAt: Date.now(),
                  expectedVersion: versionRef.current,
                });
                /* A version conflict is not an error to report and move on
                   from: the person is now holding two versions of their own
                   writing, and the only advice the copy can give -- refresh --
                   is the action that discards theirs. Keep the refused draft
                   and show the comparison instead. The stored side is read
                   directly, so the panel is built from the version that caused
                   the refusal rather than from whatever render the page happens
                   to hold; `router.refresh()` then brings the rest of the page
                   up to date without touching the editor. */
                if (operationFailureCode(caught) === 'version_conflict') {
                  const captured = await captureConflict(id, nextDraft);
                  setSaveState('error');
                  if (!captured) onError(errorMessage(caught));
                  else router.refresh();
                  return false;
                }
                onError(errorMessage(caught));
                setSaveState('error');
                return false;
              }
            }
            saveInFlightRef.current = null;
            if (!queuedDraftRef.current) break;
            saveInFlightRef.current = handle.promise;
          }
          setSaveState('saved');
          router.refresh();
          return true;
        } finally {
          saveInFlightRef.current = null;
        }
      })();
      handle.promise = work;
      saveInFlightRef.current = work;
      return work;
    },
    [captureConflict, onError, router]
  );

  /* Whether anything typed has yet to reach the server -- either still waiting
     on its debounce timer or already sent and unanswered. */
  const hasUnsavedWork = useCallback(
    () => Boolean(pendingSaveRef.current || saveInFlightRef.current),
    []
  );

  /* Finish everything owed, and say whether it all landed.
   *
   * Waiting on the save already in flight is not enough. The edit most likely
   * to be lost is the one typed a moment ago, which is still holding its
   * debounce timer and has never been sent -- so the timer is pre-empted here
   * rather than waited out. The loop repeats because finishing one save can
   * reveal the next: a newer draft queued behind the one that was in flight. */
  const flushPendingSave = useCallback(async () => {
    for (;;) {
      const pending = pendingSaveRef.current;
      if (pending) {
        if (!(await queueAutosave(pending.noteId, pending.draft))) return false;
        continue;
      }
      const inFlight = saveInFlightRef.current;
      if (!inFlight) return true;
      if (!(await inFlight)) return false;
    }
  }, [queueAutosave]);

  useEffect(() => {
    if (!noteId) return;
    if (
      persistedDraftRef.current.title === title &&
      persistedDraftRef.current.bodyMarkdown === body
    ) {
      return;
    }
    const id = noteId;
    const draft = { title, bodyMarkdown: body };
    pendingSaveRef.current = { noteId: id, draft };
    setSaveState((current) => (current === 'error' ? current : 'unsaved'));
    const timer = window.setTimeout(() => {
      void queueAutosave(id, draft);
    }, AUTOSAVE_DELAY_MS);
    // Only the timer is cancelled here. This effect re-runs on every
    // keystroke, so flushing from this cleanup would save on every keystroke
    // and the debounce would stop debouncing.
    return () => window.clearTimeout(timer);
  }, [noteId, body, queueAutosave, title]);

  /* Leaving the Note is the case that matters. The editor is remounted per
     Note, so this cleanup runs exactly when a person navigates away or opens
     another one -- the moment the pending edit would otherwise be dropped
     along with its timer.

     It must run on unmount and at no other time, so its dependency list is
     empty and the callback is reached through a ref. Depending on
     `queueAutosave` directly tied "the editor is going away" to that
     callback's identity, which changes whenever the router object does --
     and every such change fired a flush that nothing had asked for. */
  const queueAutosaveRef = useRef(queueAutosave);
  queueAutosaveRef.current = queueAutosave;
  useEffect(() => {
    return () => {
      const pending = pendingSaveRef.current;
      if (pending) void queueAutosaveRef.current(pending.noteId, pending.draft);
    };
  }, []);

  /* Taking one side of a conflict.
   *
   * Whichever side is chosen, the write goes through the ordinary versioned
   * Operation against the version now stored, so choosing is itself an
   * ordinary save -- recorded, undoable, and refused again if someone else
   * saves in the meantime. Keeping the stored version still writes, rather
   * than silently dropping the draft, so Activity records that a decision was
   * made rather than leaving a gap where someone's writing used to be. */
  const resolveConflict = useCallback(
    async (side: ConflictSide) => {
      if (!conflict || !noteId) return;
      const chosen = resolveWith(side, conflict.mine, conflict.theirs);
      try {
        const saved = await updateNote({
          id: noteId,
          title: chosen.title.trim() || 'Untitled',
          bodyMarkdown: chosen.bodyMarkdown,
          expectedVersion: conflict.theirs.version,
        });
        versionRef.current = saved.version;
        setTitle(saved.title);
        setBody(saved.bodyMarkdown);
        queuedDraftRef.current = null;
        pendingSaveRef.current = null;
        persistedDraftRef.current = { title: saved.title, bodyMarkdown: saved.bodyMarkdown };
        forgetNoteDraft(noteId);
        setConflict(null);
        setSaveState('saved');
        router.refresh();
      } catch (caught) {
        /* Someone saved again while this comparison was on screen. The decision
           cannot be applied to a version that no longer exists, and reporting a
           dead end would strand the draft in a panel with no working way out --
           so the comparison is rebuilt against what is stored now and the choice
           is offered again. */
        if (operationFailureCode(caught) === 'version_conflict') {
          const restated = await captureConflict(noteId, conflict.mine);
          if (restated) {
            onError('This Note changed again while you were choosing. Here is what it holds now.');
            return;
          }
        }
        onError(errorMessage(caught));
      }
    },
    [captureConflict, conflict, noteId, onError, router]
  );

  /* Taking the recovered copy is a decision, so the offer comes down with it
     -- otherwise the panel would still be offering what the editor now holds. */
  useEffect(() => {
    if (serverVersion && serverVersion > versionRef.current) {
      versionRef.current = serverVersion;
    }
  }, [serverVersion]);

  const restoreDraft = useCallback(
    (draft: NoteDraft) => {
      setTitle(draft.title);
      setBody(draft.bodyMarkdown);
      setDismissedDraftFor(noteId);
    },
    [noteId]
  );

  const dismissRecoverableDraft = useCallback(() => {
    if (noteId) forgetNoteDraft(noteId);
    setDismissedDraftFor(noteId);
  }, [noteId]);

  return {
    title,
    setTitle,
    body,
    setBody,
    saveState,
    versionRef,
    conflict,
    resolveConflict,
    recoverableDraft,
    restoreDraft,
    dismissRecoverableDraft,
    hasUnsavedWork,
    flushPendingSave,
  };
}
