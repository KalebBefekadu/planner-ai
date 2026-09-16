import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAFT_RETENTION_MS,
  forgetNoteDraft,
  recallNoteDraft,
  rememberNoteDraft,
} from '@/lib/note-draft-recovery';

// An unsaved Note draft is the only copy of something a person wrote. These
// are the cases where it would otherwise be lost quietly: a reload after a
// refused save, storage that throws instead of answering, and a draft old
// enough that offering it back would be a surprise rather than a rescue.

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
    key: (index: number) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size;
    },
  } as Storage;
}

const draft = {
  noteId: 'note-1',
  title: 'Half a thought',
  bodyMarkdown: '# Half a thought\n\nStill working this out.',
  savedAt: 1_000_000,
  expectedVersion: 4,
};

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: memoryStorage() });
});

describe('keeping a rejected draft', () => {
  it('returns exactly what was written', () => {
    rememberNoteDraft(draft);
    expect(recallNoteDraft('note-1', draft.savedAt + 1000)).toEqual(draft);
  });

  it('keeps drafts apart by Note, so writing never lands in another one', () => {
    rememberNoteDraft(draft);
    expect(recallNoteDraft('note-2', draft.savedAt + 1000)).toBeNull();
  });

  it('forgets a draft once it has been saved', () => {
    rememberNoteDraft(draft);
    forgetNoteDraft('note-1');
    expect(recallNoteDraft('note-1', draft.savedAt + 1000)).toBeNull();
  });
});

describe('the retention policy', () => {
  it('still offers a draft on the last day of its retention', () => {
    rememberNoteDraft(draft);
    expect(recallNoteDraft('note-1', draft.savedAt + DRAFT_RETENTION_MS - 1)).toEqual(draft);
  });

  it('drops a draft older than the policy rather than resurfacing it', () => {
    rememberNoteDraft(draft);
    // Enforced on read, so the policy does not depend on anything running in
    // the background to be true.
    expect(recallNoteDraft('note-1', draft.savedAt + DRAFT_RETENTION_MS + 1)).toBeNull();
    expect(window.localStorage.getItem('planner-note-draft:note-1')).toBeNull();
  });
});

describe('storage that does not cooperate', () => {
  it('reports no draft when storage throws instead of answering', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('site data is blocked');
      },
    });
    // A private window and a browser set to block site data both throw on
    // access. Losing the draft is acceptable; breaking the editor is not.
    expect(() => rememberNoteDraft(draft)).not.toThrow();
    expect(recallNoteDraft('note-1')).toBeNull();
  });

  it('discards a stored value that is not a draft', () => {
    const store = memoryStorage();
    store.setItem('planner-note-draft:note-1', '{"noteId":"note-1"}');
    vi.stubGlobal('window', { localStorage: store });
    expect(recallNoteDraft('note-1')).toBeNull();
    expect(store.getItem('planner-note-draft:note-1')).toBeNull();
  });

  it('discards a value that is not JSON at all', () => {
    const store = memoryStorage();
    store.setItem('planner-note-draft:note-1', 'not json');
    vi.stubGlobal('window', { localStorage: store });
    expect(recallNoteDraft('note-1')).toBeNull();
  });
});
