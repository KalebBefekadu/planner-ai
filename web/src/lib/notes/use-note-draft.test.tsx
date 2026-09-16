// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { useNoteDraft, type NoteDraft } from '@/lib/notes/use-note-draft';

const refresh = vi.fn();
// One router object for the life of the file. `useRouter` is stable in the
// app, and a mock that returns a fresh object per render would churn every
// callback that depends on it -- testing the mock rather than the hook.
const router = { refresh, replace: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const updateNote = vi.fn();
const getStoredNote = vi.fn();
vi.mock('@/app/notes/actions', () => ({
  updateNote: (input: unknown) => updateNote(input),
  getStoredNote: (id: string) => getStoredNote(id),
}));

const rememberNoteDraft = vi.fn();
const forgetNoteDraft = vi.fn();
vi.mock('@/lib/note-draft-recovery', () => ({
  rememberNoteDraft: (draft: unknown) => rememberNoteDraft(draft),
  forgetNoteDraft: (id: string) => forgetNoteDraft(id),
  noteDraftSnapshot: () => null,
  subscribeToNoteDrafts: () => () => {},
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/* A refusal as it actually reaches the client. A production build strips the
   message off anything thrown out of a Server Action and carries the code on
   `digest` instead, so that is the shape the hook has to read. */
function refusal(code: string, message = 'Refused.') {
  return Object.assign(new Error(message), { digest: `${code}: ${message}` });
}

function savedNote(draft: NoteDraft, version: number) {
  return { id: 'note-1', title: draft.title, bodyMarkdown: draft.bodyMarkdown, version };
}

function mount(onError = vi.fn()) {
  const view = renderHook(() =>
    useNoteDraft({
      noteId: 'note-1',
      initial: { title: 'Note', bodyMarkdown: 'Original body.' },
      initialVersion: 1,
      onError,
    })
  );
  return { ...view, onError };
}

/* Real timers, deliberately. Vitest's fake timers with `shouldAdvanceTime`
   fire the 800ms debounce on their own, which is the one thing these tests
   need to control -- every case here is about what happens to an edit that has
   *not* reached its timer yet. Two tests do need the debounce to fire, and
   they wait it out rather than simulate it. */
const DEBOUNCE_MS = 800;
async function letDebounceFire() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 50));
  });
}

beforeEach(() => {
  updateNote.mockReset();
  getStoredNote.mockReset();
  rememberNoteDraft.mockReset();
  forgetNoteDraft.mockReset();
  refresh.mockReset();
});

afterEach(() => {
  cleanup();
});

/* The contract this hook exists to keep: nothing a person typed is discarded
   without them being told. Each test below is one way that used to happen. */
describe('useNoteDraft', () => {
  it('reports unsaved work the moment an edit is typed, before its timer fires', async () => {
    const { result } = mount();
    expect(result.current.hasUnsavedWork()).toBe(false);

    act(() => result.current.setBody('A sentence that has not been sent yet.'));

    // No save has been attempted -- the debounce timer is still holding it.
    expect(updateNote).not.toHaveBeenCalled();
    expect(result.current.hasUnsavedWork()).toBe(true);
  });

  it('flushes an edit still holding its debounce timer rather than waiting it out', async () => {
    updateNote.mockImplementation(async (input: NoteDraft) => savedNote(input, 2));
    const { result } = mount();

    act(() => result.current.setBody('Search for this before the timer fires.'));
    let landed: boolean | undefined;
    await act(async () => {
      landed = await result.current.flushPendingSave();
    });

    expect(landed).toBe(true);
    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(updateNote.mock.calls[0][0]).toMatchObject({
      bodyMarkdown: 'Search for this before the timer fires.',
      expectedVersion: 1,
    });
    expect(result.current.hasUnsavedWork()).toBe(false);
  });

  it('waits for the save in flight and for the newer draft queued behind it', async () => {
    const first = deferred<ReturnType<typeof savedNote>>();
    updateNote
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async (input: NoteDraft) => savedNote(input, 3));
    const { result } = mount();

    // An edit sent and unanswered...
    act(() => result.current.setBody('An earlier edit awaiting its response.'));
    await letDebounceFire();
    expect(updateNote).toHaveBeenCalledTimes(1);

    // ...then a newer one typed while it is still open.
    act(() => result.current.setBody('The newest words, typed while that was open.'));

    let landed: boolean | undefined;
    const flushed = act(async () => {
      landed = await result.current.flushPendingSave();
    });
    first.resolve(savedNote({ title: 'Note', bodyMarkdown: 'An earlier edit.' }, 2));
    await flushed;

    expect(landed).toBe(true);
    // The newest draft is what reached the server last, not the earlier one.
    expect(updateNote).toHaveBeenCalledTimes(2);
    expect(updateNote.mock.calls[1][0]).toMatchObject({
      bodyMarkdown: 'The newest words, typed while that was open.',
    });
  });

  it('refuses to report success when the save was refused, and keeps the words locally', async () => {
    updateNote.mockRejectedValue(refusal('operation_failed', 'The server said no.'));
    const onError = vi.fn();
    const { result } = mount(onError);

    act(() => result.current.setBody('Do not lose this if saving fails.'));
    let landed: boolean | undefined;
    await act(async () => {
      landed = await result.current.flushPendingSave();
    });

    // False is the whole point: the caller is about to tear the page down.
    expect(landed).toBe(false);
    expect(result.current.saveState).toBe('error');
    expect(onError).toHaveBeenCalled();
    expect(rememberNoteDraft).toHaveBeenCalledWith(
      expect.objectContaining({ bodyMarkdown: 'Do not lose this if saving fails.' })
    );
  });

  it('puts both versions on screen when someone else saved first', async () => {
    updateNote.mockRejectedValue(refusal('version_conflict', 'Someone else saved this Note.'));
    getStoredNote.mockResolvedValue({
      id: 'note-1',
      title: 'Note',
      bodyMarkdown: 'What the server holds now.',
      version: 7,
    });
    const { result } = mount();

    act(() => result.current.setBody('What I wrote.'));
    let landed: boolean | undefined;
    await act(async () => {
      landed = await result.current.flushPendingSave();
    });

    expect(landed).toBe(false);
    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    expect(result.current.conflict?.mine.bodyMarkdown).toBe('What I wrote.');
    expect(result.current.conflict?.theirs.bodyMarkdown).toBe('What the server holds now.');
    // The editor is never rewritten out from under someone.
    expect(result.current.body).toBe('What I wrote.');
  });

  it('does not let an older save clear a newer edit that has never been sent', async () => {
    const first = deferred<ReturnType<typeof savedNote>>();
    updateNote
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async (input: NoteDraft) => savedNote(input, 3));
    const { result } = mount();

    act(() => result.current.setBody('First edit.'));
    await letDebounceFire();
    expect(updateNote).toHaveBeenCalledTimes(1);

    // Typed while the first save is still open, so it is owed and unsent. The
    // assertion below runs well inside its own fresh debounce window, so it is
    // reading a genuinely unsent edit rather than one that was never given
    // time to go.
    act(() => result.current.setBody('Second edit, never sent.'));
    await act(async () => {
      first.resolve(savedNote({ title: 'Note', bodyMarkdown: 'First edit.' }, 2));
      await first.promise;
    });

    // The completed save was for the first edit. The second is still owed.
    expect(result.current.hasUnsavedWork()).toBe(true);
  });
});
