'use client';

import {
  Fragment,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Bold,
  ChevronRight,
  FileText,
  FolderTree,
  FileInput,
  Heading2,
  IndentDecrease,
  IndentIncrease,
  History,
  Eye,
  Italic,
  Link2,
  List,
  ListTree,
  ListTodo,
  Mic,
  NotebookPen,
  Download,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  ShieldOff,
  Star,
  Table2,
  Tags,
  Target,
  Trash2,
  Unlink,
} from 'lucide-react';
import type { Editor } from '@tiptap/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useRouter } from 'next/navigation';
import {
  archiveNote,
  createNote,
  fileCaptureToNote,
  linkNoteAction,
  linkNoteGoal,
  linkNote,
  fileNoteUnder,
  moveNoteToNewParent,
  moveNoteWithinParent,
  restoreNoteRevision,
  setNoteFavorite,
  setNoteTags,
  setNoteAiExcluded,
  unlinkNote,
  unlinkNoteAction,
  unlinkNoteGoal,
  updateNote,
  type NoteKnowledgeContext,
  type NoteView,
} from '@/app/notes/actions';
import { nextParentMove, nextSiblingMove, parentCandidateIds } from '@/lib/notes/sibling-order';
import { NoteAppearanceHeader } from '@/components/note-appearance-header';
import { noteLocationLabel, notePath, orderFavorites } from '@/lib/notes/note-paths';
import { RichMarkdownEditor } from '@/components/rich-markdown-editor';
import { useVoiceTranscription } from '@/lib/use-voice-transcription';
import { extractPlannerMarkdownHeadings } from '@/lib/markdown/contract';
import { continueMarkdownList, wrapMarkdownSelection } from '@/lib/markdown/editing';
import { plannerMarkdownSupportsRichEditing } from '@/lib/markdown/rich-editor';
import { actionFailureMessage } from '@/lib/operations/failure-message';
import {
  forgetNoteDraft,
  noteDraftSnapshot,
  rememberNoteDraft,
  subscribeToNoteDrafts,
} from '@/lib/note-draft-recovery';

function errorMessage(error: unknown) {
  return actionFailureMessage(error, 'Unable to save this Note.');
}

export function NoteMarkdownPreview({ markdown }: { markdown: string }) {
  return (
    <article className="markdown-preview">
      {markdown ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ children, ...props }) => (
              <a {...props} rel="noreferrer" target="_blank">
                {children}
              </a>
            ),
          }}
        >
          {markdown}
        </ReactMarkdown>
      ) : (
        <p className="note-inspector-empty">Nothing to preview</p>
      )}
    </article>
  );
}

export type InspectorView = 'properties' | 'links' | 'history';

type NoteAttachment = NoteKnowledgeContext['attachments'][number];

const attachmentTypeNames: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG image',
  'image/png': 'PNG image',
  'text/markdown': 'Markdown file',
  'text/plain': 'text file',
};

function attachmentSize(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} bytes`;
  if (byteSize < 1024 * 1024) return `${Math.round(byteSize / 1024)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

// What the person is told about a file. "Security review pending" used to be
// shown for every attachment forever, which described a review that was never
// going to run and a file that could never be opened. Each state here is
// something that is actually true of the stored file.
function attachmentStatus(attachment: NoteAttachment) {
  if (attachment.scanState === 'rejected') {
    return `Not available: contents do not match a ${
      attachmentTypeNames[attachment.mediaType] ?? 'file'
    }`;
  }
  if (attachment.scanState === 'quarantined') return 'Checking this file';
  return attachmentSize(attachment.byteSize);
}

function restorableUntil(purgeAfter: string | null) {
  if (!purgeAfter) return 'Restore is no longer available.';
  return `Restore by ${new Date(purgeAfter).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}.`;
}

export function NotesWorkspace({
  notes,
  favorites,
  selectedId,
  query,
  knowledge,
  inspectorView,
  onInspectorViewChange,
  onRequestImport,
}: {
  notes: NoteView[];
  favorites: NoteView[];
  selectedId: string | null;
  query: string;
  knowledge: NoteKnowledgeContext | null;
  inspectorView: InspectorView;
  onInspectorViewChange: (view: InspectorView) => void;
  onRequestImport: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  /* A Note is reachable from two places, and opening it has to work from
     both. `notes` is the tree, which a search narrows; the favourites list is
     deliberately not narrowed, because being able to leave a search is the
     point of keeping a Note close. Resolving the selection from the tree alone
     meant clicking a favourite while a search was active navigated correctly
     and then displayed whatever the filtered tree happened to list first --
     the one moment the list exists for. */
  const selected =
    notes.find((note) => note.id === selectedId) ??
    favorites.find((note) => note.id === selectedId) ??
    null;
  const activeNoteId = selected?.id ?? null;
  const [title, setTitle] = useState(selected?.title ?? '');
  const [body, setBody] = useState(selected?.bodyMarkdown ?? '');
  const versionRef = useRef(selected?.version ?? 1);
  const [saveState, setSaveState] = useState<'saved' | 'unsaved' | 'saving' | 'error'>('saved');
  const [dismissedDraftFor, setDismissedDraftFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tagText, setTagText] = useState(knowledge?.tags.join(', ') ?? '');
  const [targetNoteId, setTargetNoteId] = useState('');
  const [filingParentId, setFilingParentId] = useState('');
  const [targetGoalId, setTargetGoalId] = useState('');
  const [targetActionId, setTargetActionId] = useState('');
  const [relationType, setRelationType] =
    useState<NoteKnowledgeContext['links'][number]['relationType']>('related');
  const [editorMode, setEditorMode] = useState<'source' | 'rich' | 'preview'>('source');
  const [richEditor, setRichEditor] = useState<Editor | null>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const persistedDraftRef = useRef({
    title: selected?.title ?? '',
    bodyMarkdown: selected?.bodyMarkdown ?? '',
  });
  const saveInFlightRef = useRef(false);
  const queuedDraftRef = useRef<{ title: string; bodyMarkdown: string } | null>(null);
  // The autosave pipeline is bound to the Note it belongs to. Switching Notes
  // used to clear the pending timer and drop whatever had been typed in the
  // last 800ms, and the draft had no way of naming which Note it came from.
  const pendingSaveRef = useRef<{
    noteId: string;
    draft: { title: string; bodyMarkdown: string };
  } | null>(null);
  // A draft left behind by a refused save. Read through the store rather than
  // mirrored into state, so the server and the first client render agree that
  // there is nothing to offer until storage has actually been read.
  const storedDraft = useSyncExternalStore(
    subscribeToNoteDrafts,
    () => (activeNoteId ? noteDraftSnapshot(activeNoteId) : null),
    () => null
  );
  const recoverableDraft =
    storedDraft &&
    storedDraft.noteId === activeNoteId &&
    storedDraft.bodyMarkdown !== body &&
    dismissedDraftFor !== activeNoteId
      ? storedDraft
      : null;
  // Favourites arrive already ordered by the server, but the ordering rule is
  // shared with the tests and applied here too so a stale or reordered payload
  // cannot quietly change what a person sees.
  const favoriteNotes = useMemo(() => orderFavorites(favorites), [favorites]);
  const isFavorite = favoriteNotes.some((note) => note.id === selectedId);
  // The breadcrumb is the whole ancestor chain, not just the immediate parent.
  // A Note three levels down used to report the same one-step location as a
  // Note one level down, which is no location at all in a deep tree, and the
  // trail was plain text so there was nothing to click on the way back up.
  const breadcrumbTrail = useMemo(
    () => (selectedId ? notePath(notes, selectedId).slice(0, -1) : []),
    [notes, selectedId]
  );
  const outline = useMemo(() => extractPlannerMarkdownHeadings(body), [body]);
  const richEditable = useMemo(() => plannerMarkdownSupportsRichEditing(body), [body]);
  const activeEditorMode = editorMode === 'rich' && !richEditable ? 'source' : editorMode;
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;
  // Which moves are open to this Note, decided by the same functions the server
  // uses to perform them. Working it out separately here would let the controls
  // offer a move the server then refuses, or hide one it would have allowed.
  const availableMoves = useMemo(() => {
    const none = { up: false, down: false, indent: false, outdent: false };
    if (!selected) return none;
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
  }, [notes, selected]);

  function applyMove(move: () => Promise<NoteView | null>) {
    startTransition(async () => {
      try {
        const moved = await move();
        if (moved) versionRef.current = moved.version;
        router.refresh();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function moveSelected(direction: 'up' | 'down') {
    if (!selected) return;
    applyMove(() =>
      moveNoteWithinParent({ id: selected.id, direction, expectedVersion: versionRef.current })
    );
  }

  function reparentSelected(direction: 'indent' | 'outdent') {
    if (!selected) return;
    applyMove(() =>
      moveNoteToNewParent({ id: selected.id, direction, expectedVersion: versionRef.current })
    );
  }

  // The tree is nested lists rather than one flat run of buttons.
  //
  // Indentation alone said nothing to a screen reader, which read every Note as
  // a peer however deeply it was filed, and the mobile layout overrode that
  // indentation outright so the hierarchy vanished on a phone. Real nesting
  // carries the structure to assistive technology and to a narrow screen, and
  // it cannot fall out of step with where a Note actually sits.
  // A search result is not a place in the hierarchy, it is an answer. The tree
  // is drawn from the roots downwards, so a match nested under a Note that does
  // not itself match had no rendered ancestor to hang from and was silently
  // dropped -- the deeper a Note was filed, the less findable it became, which
  // is the opposite of what search is for. While a query is active the sidebar
  // shows the matches themselves, flat and in tree order.
  //
  // Each result carries where it is filed. Two Notes both called "Notes" were
  // two identical buttons: the list gave a person no way to tell which one they
  // were about to open, and opening the wrong one is how notes get written into
  // the wrong page. Titles are not unique and were never meant to be, so the
  // path is what makes a result identifiable. The ancestors that supply it are
  // fetched alongside the matches; they are not results themselves, and listing
  // them would answer a question nobody asked.
  function renderSearchResults() {
    const results = notes
      .filter((note) => note.matchesQuery !== false)
      .sort((first, second) => first.sortKey - second.sortKey);
    if (!results.length) return null;
    return (
      <ul className="note-tree-level">
        {results.map((note) => (
          <li key={note.id}>{renderNoteButton(note, noteLocationLabel(notes, note.id))}</li>
        ))}
      </ul>
    );
  }

  function toggleFavorite() {
    if (!selected) return;
    const favorite = !isFavorite;
    startTransition(async () => {
      try {
        const saved = await setNoteFavorite(selected.id, favorite, versionRef.current);
        versionRef.current = saved.version;
        router.refresh();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  // A flat result list drops the one thing that told two identically titled
  // pages apart, so whatever ancestor chain is in hand is shown underneath the
  // title: "Notes" under Acme and "Notes" under Globex are distinguishable
  // before the click rather than after it.
  function renderNoteButton(note: NoteView, locationLabel?: string) {
    return (
      <button
        className={`note-tree-item${note.id === selected?.id ? ' note-tree-item-active' : ''}`}
        type="button"
        onClick={() => openNoteFromTree(note.id)}
      >
        <span>
          {note.title}
          {locationLabel ? (
            <small className="note-tree-item-location">{locationLabel}</small>
          ) : null}
        </span>
        {note.aiExcluded ? <ShieldOff size={13} aria-label="Excluded from AI" /> : null}
      </button>
    );
  }

  // Opening a result must not discard the query that produced it. Dropping it
  // returned the sidebar to the whole tree on the first click, so a person
  // reading through several matches had to retype the search each time.
  function openNoteFromTree(noteId: string) {
    const search = new URLSearchParams({ note: noteId });
    if (query) search.set('q', query);
    router.push(`/notes?${search.toString()}`);
  }

  function renderNoteLevel(parentNoteId: string | null) {
    const level = notes
      .filter((note) => note.parentNoteId === parentNoteId)
      .sort((first, second) => first.sortKey - second.sortKey);
    if (!level.length) return null;
    return (
      <ul className="note-tree-level">
        {level.map((note) => (
          <li key={note.id}>
            {renderNoteButton(note)}
            {renderNoteLevel(note.id)}
          </li>
        ))}
      </ul>
    );
  }

  function focusOutlineLine(line: number) {
    setEditorMode('source');
    window.requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const offset = body
        .split('\n')
        .slice(0, Math.max(0, line - 1))
        .reduce((total, sourceLine) => total + sourceLine.length + 1, 0);
      editor.focus();
      editor.setSelectionRange(offset, offset);
    });
  }
  const insertTranscript = useCallback(
    (transcript: string) => {
      if (activeEditorMode === 'rich' && richEditor) {
        richEditor.chain().focus().insertContent(transcript).run();
        return;
      }
      const editor = editorRef.current;
      const start = editor?.selectionStart ?? body.length;
      const end = editor?.selectionEnd ?? body.length;
      const separator = body.slice(0, start).trim() && !/\s$/.test(body.slice(0, start)) ? ' ' : '';
      const nextBody = `${body.slice(0, start)}${separator}${transcript}${body.slice(end)}`;
      setBody(nextBody);
      window.requestAnimationFrame(() => {
        editor?.focus();
        const cursor = start + separator.length + transcript.length;
        editor?.setSelectionRange(cursor, cursor);
      });
    },
    [activeEditorMode, body, richEditor]
  );
  const voice = useVoiceTranscription({ onTranscript: insertTranscript });

  // The Note being saved is passed in rather than read from the closure. The
  // save that matters most is the one for the Note a person has just left, and
  // by then activeNoteId already names a different Note.
  const queueAutosave = useCallback(
    async (noteId: string, draft: { title: string; bodyMarkdown: string }) => {
      queuedDraftRef.current = draft;
      if (saveInFlightRef.current) return;

      saveInFlightRef.current = true;
      setSaveState('saving');
      try {
        while (queuedDraftRef.current) {
          const nextDraft = queuedDraftRef.current;
          queuedDraftRef.current = null;
          try {
            const saved = await updateNote({
              id: noteId,
              title: nextDraft.title.trim() || 'Untitled',
              bodyMarkdown: nextDraft.bodyMarkdown,
              expectedVersion: versionRef.current,
            });
            versionRef.current = saved.version;
            persistedDraftRef.current = nextDraft;
            pendingSaveRef.current = null;
            forgetNoteDraft(noteId);
          } catch (caught) {
            queuedDraftRef.current ??= nextDraft;
            // A refused save is the moment the words are least safe: they
            // exist only in this tab. Keep a local copy so a reload, a crash
            // or a closed laptop does not take them with it.
            rememberNoteDraft({
              noteId,
              title: nextDraft.title,
              bodyMarkdown: nextDraft.bodyMarkdown,
              savedAt: Date.now(),
              expectedVersion: versionRef.current,
            });
            setError(errorMessage(caught));
            setSaveState('error');
            return;
          }
        }
        setSaveState('saved');
        router.refresh();
      } finally {
        saveInFlightRef.current = false;
      }
    },
    [router]
  );

  useEffect(() => {
    if (!activeNoteId) return;
    if (
      persistedDraftRef.current.title === title &&
      persistedDraftRef.current.bodyMarkdown === body
    ) {
      return;
    }
    const noteId = activeNoteId;
    const draft = { title, bodyMarkdown: body };
    pendingSaveRef.current = { noteId, draft };
    setSaveState((current) => (current === 'error' ? current : 'unsaved'));
    const timer = window.setTimeout(() => {
      void queueAutosave(noteId, draft);
    }, 800);
    // Only the timer is cancelled here. This effect re-runs on every
    // keystroke, so flushing from this cleanup would save on every keystroke
    // and the debounce would stop debouncing.
    return () => window.clearTimeout(timer);
  }, [activeNoteId, body, queueAutosave, title]);

  // Leaving the Note is the case that matters. The editor is remounted per
  // Note, so this cleanup runs exactly when a person navigates away or opens
  // another one -- the moment the pending edit would otherwise be dropped
  // along with its timer.
  useEffect(() => {
    return () => {
      const pending = pendingSaveRef.current;
      if (pending) void queueAutosave(pending.noteId, pending.draft);
    };
  }, [queueAutosave]);

  useEffect(() => {
    if (selected?.version && selected.version > versionRef.current) {
      versionRef.current = selected.version;
    }
  }, [selected?.version]);

  // Offer back anything a refused save left behind, rather than letting a
  // reload quietly decide the writing never happened.

  function newNote(parentNoteId: string | null) {
    startTransition(async () => {
      try {
        const note = await createNote(parentNoteId);
        router.push(`/notes?note=${note.id}`);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function wrapSelection(prefix: string, suffix = prefix) {
    const editor = editorRef.current;
    if (!editor) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const edit = wrapMarkdownSelection(body, start, end, prefix, suffix);
    setBody(edit.markdown);
    window.requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  }

  function insertMarkdownTable() {
    const editor = editorRef.current;
    if (!editor) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const table = '| Column | Column |\n| --- | --- |\n| Value | Value |';
    const prefix = before && !before.endsWith('\n') ? '\n\n' : '';
    const suffix = after && !after.startsWith('\n') ? '\n\n' : '';
    const nextBody = `${before}${prefix}${table}${suffix}${after}`;
    const selectionStart = before.length + prefix.length + 2;
    setBody(nextBody);
    window.requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(selectionStart, selectionStart + 'Column'.length);
    });
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.metaKey || event.ctrlKey) {
      if (event.key.toLowerCase() === 'b') {
        event.preventDefault();
        wrapSelection('**');
      } else if (event.key.toLowerCase() === 'i') {
        event.preventDefault();
        wrapSelection('_');
      }
      return;
    }
    if (event.key !== 'Enter') return;
    const editor = event.currentTarget;
    const edit = continueMarkdownList(body, editor.selectionStart, editor.selectionEnd);
    if (!edit) return;
    event.preventDefault();
    setBody(edit.markdown);
    window.requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  }

  function formatRichOrSource(sourceEdit: () => void, richEdit: (editor: Editor) => void) {
    if (activeEditorMode === 'rich') {
      if (richEditor) richEdit(richEditor);
      return;
    }
    sourceEdit();
  }

  function runKnowledgeAction(action: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  async function uploadAttachment(file: File) {
    if (!selected) return;
    setError(null);
    setIsUploadingAttachment(true);
    try {
      const form = new FormData();
      form.append('noteId', selected.id);
      form.append('file', file);
      const response = await fetch('/api/notes/attachments', { method: 'POST', body: form });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error ?? 'Attachment upload could not be completed.');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsUploadingAttachment(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    }
  }

  async function removeAttachment(attachmentId: string) {
    if (!window.confirm('Remove this attachment?')) return;
    setError(null);
    setIsUploadingAttachment(true);
    try {
      const response = await fetch('/api/notes/attachments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attachmentId }),
      });
      const payload =
        response.status === 204 ? null : ((await response.json()) as { error?: string });
      if (!response.ok)
        throw new Error(payload?.error ?? 'Attachment removal could not be completed.');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsUploadingAttachment(false);
    }
  }

  async function restoreAttachment(attachmentId: string) {
    setError(null);
    setIsUploadingAttachment(true);
    try {
      const response = await fetch('/api/notes/attachments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attachmentId }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? 'Attachment restoration could not be completed.');
      }
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsUploadingAttachment(false);
    }
  }

  const liveAttachments = (knowledge?.attachments ?? []).filter(
    (attachment) => !attachment.removedAt
  );
  const removedAttachments = (knowledge?.attachments ?? []).filter(
    (attachment) => attachment.removedAt
  );

  const availableTargets = notes.filter((note) => note.id !== selected?.id);
  // A Note cannot be filed under itself or under anything hanging beneath it,
  // because that would take the whole branch out of the tree. Those places are
  // never offered, and the server checks again against the live hierarchy.
  const filingCandidates = useMemo(() => {
    if (!selected) return [];
    const tree = notes.map((note) => ({
      id: note.id,
      parentNoteId: note.parentNoteId,
      sortKey: note.sortKey,
    }));
    const allowed = new Set(parentCandidateIds(tree, selected.id));
    return notes.filter((note) => allowed.has(note.id) && note.id !== selected.parentNoteId);
  }, [notes, selected]);
  const connectionCount =
    (knowledge?.links.length ?? 0) +
    (knowledge?.goalLinks.length ?? 0) +
    (knowledge?.actionLinks.length ?? 0);
  const noteName = (id: string) => notes.find((note) => note.id === id)?.title ?? 'Missing Note';

  return (
    <div className="notes-shell">
      <aside className="notes-sidebar">
        <div className="notes-sidebar-heading">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1>
              Notes <small aria-hidden="true">{notes.length}</small>
            </h1>
          </div>
          <div className="notes-sidebar-actions">
            <button
              className="icon-button"
              type="button"
              title="Import Notes"
              aria-label="Import Notes"
              onClick={onRequestImport}
              disabled={isPending}
            >
              <FileInput size={16} />
            </button>
            <button
              className="icon-button"
              type="button"
              title="New root note"
              aria-label="New root note"
              onClick={() => newNote(null)}
              disabled={isPending}
            >
              <Plus size={17} />
            </button>
          </div>
        </div>
        <form className="notes-search">
          <Search size={15} aria-hidden="true" />
          <input
            name="q"
            defaultValue={query}
            placeholder="Search notes"
            aria-label="Search notes"
          />
        </form>
        {favoriteNotes.length ? (
          <nav className="note-favorites" aria-label="Favorite notes">
            <h2 className="note-favorites-heading">Favorites</h2>
            <ul className="note-tree-level">
              {favoriteNotes.map((note) => (
                <li key={note.id}>{renderNoteButton(note)}</li>
              ))}
            </ul>
          </nav>
        ) : null}
        <nav className="note-tree" aria-label="Notes">
          {notes.length ? (
            query ? (
              renderSearchResults()
            ) : (
              renderNoteLevel(null)
            )
          ) : (
            <div className="note-tree-empty">
              <NotebookPen size={17} aria-hidden="true" />
              {/*
               * A search that found nothing and a workspace that holds nothing
               * look identical unless they are told apart, and the second
               * message reads as data loss when the first one is true.
               */}
              <p>{query ? 'No Notes match this search.' : 'Your pages will appear here.'}</p>
            </div>
          )}
        </nav>
      </aside>

      <section className="note-editor-pane">
        {selected ? (
          <>
            {/* WS-03: the accepted /preview document header. It owns its own
                controls and its own saves, so the editor below is unchanged. */}
            <NoteAppearanceHeader
              // Keyed by Note so switching pages starts from that page's own
              // stored appearance instead of carrying a draft across.
              key={selected.id}
              noteId={selected.id}
              appearance={selected.appearance}
              versionRef={versionRef}
              onSaved={(version) => {
                versionRef.current = version;
                router.refresh();
              }}
              onError={setError}
            />
            <div className="note-editor-header">
              <div className="note-title-group">
                <nav className="note-editor-breadcrumb" aria-label="Note location">
                  <span>Workspace</span>
                  <ChevronRight size={13} aria-hidden="true" />
                  <span>Notes</span>
                  {breadcrumbTrail.map((ancestor) => (
                    <Fragment key={ancestor.id}>
                      <ChevronRight size={13} aria-hidden="true" />
                      <button
                        className="note-breadcrumb-link"
                        type="button"
                        onClick={() => openNoteFromTree(ancestor.id)}
                      >
                        {ancestor.title}
                      </button>
                    </Fragment>
                  ))}
                </nav>
                <input
                  className="note-title-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  aria-label="Note title"
                  maxLength={300}
                />
                <p>
                  <FileText size={13} aria-hidden="true" />
                  Markdown
                  <span aria-hidden="true">·</span>
                  Edited{' '}
                  {new Intl.DateTimeFormat('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  }).format(new Date(selected.updatedAt))}
                </p>
              </div>
              <div className="note-header-actions">
                <span className={`save-state save-state-${saveState}`} role="status">
                  {saveState === 'saving'
                    ? 'Saving'
                    : saveState === 'error'
                      ? 'Not saved'
                      : saveState === 'unsaved'
                        ? 'Unsaved changes'
                        : 'Saved'}
                </span>
                <button
                  className="icon-button"
                  type="button"
                  title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  aria-pressed={isFavorite}
                  disabled={isPending}
                  onClick={toggleFavorite}
                >
                  <Star size={16} fill={isFavorite ? 'currentColor' : 'none'} />
                </button>
                <label className="ai-exclusion-toggle">
                  <input
                    type="checkbox"
                    checked={selected.aiExcluded}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      startTransition(async () => {
                        try {
                          const saved = await setNoteAiExcluded(
                            selected.id,
                            checked,
                            versionRef.current
                          );
                          versionRef.current = saved.version;
                          router.refresh();
                        } catch (caught) {
                          setError(errorMessage(caught));
                        }
                      });
                    }}
                  />
                  Exclude from AI
                </label>
                {availableMoves.up ||
                availableMoves.down ||
                availableMoves.indent ||
                availableMoves.outdent ? (
                  <div className="note-move-controls" role="group" aria-label="Move note">
                    <button
                      className="icon-button"
                      type="button"
                      title="Move note up"
                      aria-label="Move note up"
                      disabled={!availableMoves.up || isPending}
                      onClick={() => moveSelected('up')}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="Move note down"
                      aria-label="Move note down"
                      disabled={!availableMoves.down || isPending}
                      onClick={() => moveSelected('down')}
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="Make child of the note above"
                      aria-label="Make child of the note above"
                      disabled={!availableMoves.indent || isPending}
                      onClick={() => reparentSelected('indent')}
                    >
                      <IndentIncrease size={16} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="Move note out of its parent"
                      aria-label="Move note out of its parent"
                      disabled={!availableMoves.outdent || isPending}
                      onClick={() => reparentSelected('outdent')}
                    >
                      <IndentDecrease size={16} />
                    </button>
                  </div>
                ) : null}
                <button
                  className="icon-button"
                  type="button"
                  title="Archive note"
                  aria-label="Archive note"
                  onClick={() => {
                    if (!window.confirm('Archive this Note?')) return;
                    startTransition(async () => {
                      await archiveNote(selected.id, versionRef.current);
                      router.push('/notes');
                      router.refresh();
                    });
                  }}
                >
                  <Archive size={16} />
                </button>
              </div>
            </div>
            {error ? (
              <p className="status-message status-message-error" role="alert">
                {error}
              </p>
            ) : null}
            {voice.error ? (
              <p className="status-message status-message-error" role="alert">
                {voice.error}
              </p>
            ) : null}
            {recoverableDraft ? (
              // A refused save left the only copy of this writing in the
              // browser. Offer it back rather than deciding for the person
              // which version wins. Not a live region: this is a prompt to act
              // on, and the save state is the editor's one status.
              <section className="note-draft-recovery" aria-label="Recover unsaved changes">
                <p>
                  Unsaved changes from{' '}
                  {new Intl.DateTimeFormat('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  }).format(new Date(recoverableDraft.savedAt))}{' '}
                  were kept on this device because a save did not go through.
                </p>
                <div className="note-draft-recovery-actions">
                  <button
                    className="btn-primary"
                    type="button"
                    onClick={() => {
                      setTitle(recoverableDraft.title);
                      setBody(recoverableDraft.bodyMarkdown);
                      setDismissedDraftFor(activeNoteId);
                    }}
                  >
                    Restore them
                  </button>
                  <button
                    className="btn-secondary"
                    type="button"
                    onClick={() => {
                      if (activeNoteId) forgetNoteDraft(activeNoteId);
                      setDismissedDraftFor(activeNoteId);
                    }}
                  >
                    Discard
                  </button>
                </div>
                <small>Kept on this device for seven days, then removed.</small>
              </section>
            ) : null}
            <div className="markdown-toolbar" role="toolbar" aria-label="Markdown formatting">
              <div className="markdown-tools">
                <button
                  type="button"
                  title="Heading"
                  aria-label="Heading"
                  onMouseDown={(event) => {
                    if (activeEditorMode === 'rich') event.preventDefault();
                  }}
                  onClick={() =>
                    formatRichOrSource(
                      () => wrapSelection('## ', ''),
                      (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run()
                    )
                  }
                  disabled={activeEditorMode === 'preview'}
                >
                  <Heading2 size={16} />
                </button>
                <button
                  type="button"
                  title="Bold"
                  aria-label="Bold"
                  onMouseDown={(event) => {
                    if (activeEditorMode === 'rich') event.preventDefault();
                  }}
                  onClick={() =>
                    formatRichOrSource(
                      () => wrapSelection('**'),
                      (editor) => editor.chain().focus().toggleBold().run()
                    )
                  }
                  disabled={activeEditorMode === 'preview'}
                >
                  <Bold size={16} />
                </button>
                <button
                  type="button"
                  title="Italic"
                  aria-label="Italic"
                  onMouseDown={(event) => {
                    if (activeEditorMode === 'rich') event.preventDefault();
                  }}
                  onClick={() =>
                    formatRichOrSource(
                      () => wrapSelection('_'),
                      (editor) => editor.chain().focus().toggleItalic().run()
                    )
                  }
                  disabled={activeEditorMode === 'preview'}
                >
                  <Italic size={16} />
                </button>
                <button
                  type="button"
                  title="List"
                  aria-label="List"
                  onMouseDown={(event) => {
                    if (activeEditorMode === 'rich') event.preventDefault();
                  }}
                  onClick={() =>
                    formatRichOrSource(
                      () => wrapSelection('- ', ''),
                      (editor) => editor.chain().focus().toggleBulletList().run()
                    )
                  }
                  disabled={activeEditorMode === 'preview'}
                >
                  <List size={16} />
                </button>
                <button
                  type="button"
                  title="Task list"
                  aria-label="Task list"
                  onMouseDown={(event) => {
                    if (activeEditorMode === 'rich') event.preventDefault();
                  }}
                  onClick={() =>
                    formatRichOrSource(
                      () => wrapSelection('- [ ] ', ''),
                      (editor) => editor.chain().focus().toggleTaskList().run()
                    )
                  }
                  disabled={activeEditorMode === 'preview'}
                >
                  <ListTodo size={16} />
                </button>
                <button
                  type="button"
                  title="Table"
                  aria-label="Table"
                  onMouseDown={(event) => {
                    if (activeEditorMode === 'rich') event.preventDefault();
                  }}
                  onClick={() =>
                    formatRichOrSource(insertMarkdownTable, (editor) =>
                      editor
                        .chain()
                        .focus()
                        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                        .run()
                    )
                  }
                  disabled={activeEditorMode === 'preview'}
                >
                  <Table2 size={16} />
                </button>
                <button
                  type="button"
                  title={voice.isRecording ? 'Stop dictation' : 'Start dictation'}
                  aria-label={voice.isRecording ? 'Stop dictation' : 'Start dictation'}
                  aria-pressed={voice.isRecording}
                  onClick={() => (voice.isRecording ? voice.stop() : void voice.start())}
                  disabled={activeEditorMode === 'preview' || voice.isTranscribing}
                >
                  <Mic size={16} />
                </button>
              </div>
              <div className="editor-mode-control" aria-label="Editor mode">
                <button
                  type="button"
                  className={activeEditorMode === 'source' ? 'editor-mode-active' : undefined}
                  aria-pressed={activeEditorMode === 'source'}
                  onClick={() => setEditorMode('source')}
                >
                  <FileInput size={14} />
                  Source
                </button>
                <button
                  type="button"
                  className={activeEditorMode === 'rich' ? 'editor-mode-active' : undefined}
                  aria-pressed={activeEditorMode === 'rich'}
                  disabled={!richEditable}
                  title={
                    richEditable
                      ? 'Edit with rich formatting'
                      : 'This Note has Markdown that must stay in source mode to preserve it.'
                  }
                  onClick={() => setEditorMode('rich')}
                >
                  <FileText size={14} />
                  Rich
                </button>
                <button
                  type="button"
                  className={activeEditorMode === 'preview' ? 'editor-mode-active' : undefined}
                  aria-pressed={activeEditorMode === 'preview'}
                  onClick={() => setEditorMode('preview')}
                >
                  <Eye size={14} />
                  Preview
                </button>
              </div>
              <button
                type="button"
                className="new-child-button"
                onClick={() => newNote(selected.id)}
              >
                <Plus size={15} />
                Child note
              </button>
              <span className="note-word-count" aria-live="polite">
                {wordCount} {wordCount === 1 ? 'word' : 'words'}
              </span>
            </div>
            {!richEditable ? (
              <p className="note-editor-notice" role="status">
                This Note includes portable Markdown that stays in source mode until every construct
                can be preserved.
              </p>
            ) : null}
            <div className="note-content-layout">
              {activeEditorMode === 'source' ? (
                <textarea
                  ref={editorRef}
                  aria-label="Note body, Markdown"
                  className="markdown-editor"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  onKeyDown={onEditorKeyDown}
                  placeholder="Write in Markdown..."
                  spellCheck
                />
              ) : activeEditorMode === 'rich' ? (
                <RichMarkdownEditor
                  markdown={body}
                  onChange={setBody}
                  onEditorChange={setRichEditor}
                />
              ) : (
                <NoteMarkdownPreview markdown={body} />
              )}
              <aside
                className="note-inspector"
                aria-label="Note connections and history"
                data-inspector-view={inspectorView}
              >
                <nav className="note-inspector-tabs" aria-label="Note details">
                  {(['properties', 'links', 'history'] as const).map((view) => (
                    <button
                      key={view}
                      type="button"
                      aria-pressed={inspectorView === view}
                      onClick={() => onInspectorViewChange(view)}
                    >
                      {view[0].toUpperCase() + view.slice(1)}
                      {/*
                       * Nothing outside this pane says a Note has connections,
                       * so a backlink someone else created was invisible unless
                       * they thought to look. The count is decoration over the
                       * label, which stays the button's accessible name.
                       */}
                      {view === 'links' && connectionCount ? (
                        <span className="note-inspector-tab-count" aria-hidden="true">
                          {connectionCount}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </nav>
                <section className="note-inspector-section" data-inspector-group="history">
                  <h2>
                    <ListTree size={15} aria-hidden="true" />
                    Outline
                  </h2>
                  {outline.length ? (
                    <nav className="note-outline-list" aria-label="Note outline">
                      {outline.map((heading) => (
                        <button
                          key={`${heading.line}-${heading.text}`}
                          type="button"
                          className={`note-outline-depth-${Math.min(heading.depth - 1, 4)}`}
                          onClick={() => focusOutlineLine(heading.line)}
                        >
                          {heading.text}
                        </button>
                      ))}
                    </nav>
                  ) : (
                    <p className="note-inspector-empty">Add headings to create an outline</p>
                  )}
                </section>
                <section className="note-inspector-section" data-inspector-group="properties">
                  <h2>
                    <FolderTree size={15} aria-hidden="true" />
                    Filing
                  </h2>
                  <p className="note-inspector-note">
                    {selected.parentNoteId
                      ? `Filed under ${noteName(selected.parentNoteId)}`
                      : 'Filed at the top level'}
                  </p>
                  <div className="note-link-creator">
                    <select
                      value={filingParentId}
                      onChange={(event) => setFilingParentId(event.target.value)}
                      aria-label="File this Note under"
                    >
                      <option value="">Choose a place</option>
                      {selected.parentNoteId === null ? null : (
                        <option value="root">Top level</option>
                      )}
                      {filingCandidates.map((note) => (
                        <option key={note.id} value={note.id}>
                          {note.title}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!filingParentId || isPending}
                      onClick={() => {
                        const destination = filingParentId === 'root' ? null : filingParentId;
                        applyMove(async () => {
                          const moved = await fileNoteUnder({
                            id: selected.id,
                            parentNoteId: destination,
                            expectedVersion: versionRef.current,
                          });
                          setFilingParentId('');
                          return moved;
                        });
                      }}
                    >
                      Move
                    </button>
                  </div>
                </section>
                <section className="note-inspector-section" data-inspector-group="properties">
                  <h2>
                    <Paperclip size={15} aria-hidden="true" />
                    Attachments
                  </h2>
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    className="sr-only"
                    accept="application/pdf,image/jpeg,image/png,text/markdown,text/plain,.md,.txt"
                    aria-label="Attach a file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadAttachment(file);
                    }}
                  />
                  <button
                    type="button"
                    className="note-attachment-upload"
                    disabled={isUploadingAttachment}
                    onClick={() => attachmentInputRef.current?.click()}
                  >
                    <Paperclip size={14} />
                    {isUploadingAttachment ? 'Uploading' : 'Attach file'}
                  </button>
                  <div className="note-attachment-list">
                    {liveAttachments.map((attachment) => (
                      <div key={attachment.id} className="note-attachment-row">
                        <div>
                          <strong>{attachment.originalName}</strong>
                          <span className="note-attachment-actions">
                            {attachment.scanState === 'rejected' ? null : (
                              <a
                                className="note-icon-quiet"
                                href={`/api/notes/attachments?attachmentId=${encodeURIComponent(attachment.id)}`}
                                title="Download attachment"
                                aria-label={`Download attachment ${attachment.originalName}`}
                                role="button"
                                download
                              >
                                <Download size={14} />
                              </a>
                            )}
                            <button
                              type="button"
                              className="note-icon-quiet"
                              title="Remove attachment"
                              aria-label={`Remove attachment ${attachment.originalName}`}
                              disabled={isUploadingAttachment}
                              onClick={() => void removeAttachment(attachment.id)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </span>
                        </div>
                        <span>{attachmentStatus(attachment)}</span>
                      </div>
                    ))}
                    {!liveAttachments.length && !removedAttachments.length ? (
                      <p className="note-inspector-empty">No attachments</p>
                    ) : null}
                    {removedAttachments.map((attachment) => (
                      <div key={attachment.id} className="note-attachment-row">
                        <div>
                          <strong>{attachment.originalName}</strong>
                          <button
                            type="button"
                            className="note-icon-quiet"
                            title="Restore attachment"
                            aria-label={`Restore attachment ${attachment.originalName}`}
                            disabled={isUploadingAttachment}
                            onClick={() => void restoreAttachment(attachment.id)}
                          >
                            <RotateCcw size={14} />
                          </button>
                        </div>
                        <span>Removed. {restorableUntil(attachment.purgeAfter)}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="note-inspector-section" data-inspector-group="properties">
                  <h2>
                    <Tags size={15} aria-hidden="true" />
                    Tags
                  </h2>
                  <div className="note-inline-control">
                    <input
                      value={tagText}
                      onChange={(event) => setTagText(event.target.value)}
                      placeholder="work, research"
                      aria-label="Comma-separated tags"
                      maxLength={500}
                    />
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        runKnowledgeAction(() =>
                          setNoteTags(
                            selected.id,
                            tagText
                              .split(',')
                              .map((tag) => tag.trim())
                              .filter(Boolean)
                          )
                        )
                      }
                    >
                      Save
                    </button>
                  </div>
                  {knowledge?.tags.length ? (
                    <div className="note-tag-list">
                      {knowledge.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="note-inspector-empty">No tags</p>
                  )}
                </section>

                <section className="note-inspector-section" data-inspector-group="properties">
                  <h2>
                    <Target size={15} aria-hidden="true" />
                    Plan connections
                  </h2>
                  <div className="note-plan-links">
                    <div className="note-plan-link-group">
                      <span>
                        <Target size={12} aria-hidden="true" /> Goals
                      </span>
                      {knowledge?.goals.some((goal) => !knowledge.goalLinks.includes(goal.id)) ? (
                        <div className="note-inline-control">
                          <select
                            value={targetGoalId}
                            onChange={(event) => setTargetGoalId(event.target.value)}
                            aria-label="Goal to connect"
                          >
                            <option value="">Choose a Goal</option>
                            {knowledge.goals
                              .filter((goal) => !knowledge.goalLinks.includes(goal.id))
                              .map((goal) => (
                                <option key={goal.id} value={goal.id}>
                                  {goal.title}
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            disabled={!targetGoalId || isPending}
                            onClick={() => {
                              const goalId = targetGoalId;
                              runKnowledgeAction(async () => {
                                await linkNoteGoal(selected.id, goalId);
                                setTargetGoalId('');
                              });
                            }}
                          >
                            Link
                          </button>
                        </div>
                      ) : null}
                      {knowledge?.goalLinks.map((goalId) => (
                        <div key={goalId} className="note-plan-link-row">
                          <strong>
                            {knowledge.goals.find((goal) => goal.id === goalId)?.title ??
                              'Missing Goal'}
                          </strong>
                          <button
                            type="button"
                            className="note-icon-quiet"
                            title="Remove Goal link"
                            aria-label="Remove Goal link"
                            onClick={() =>
                              runKnowledgeAction(() => unlinkNoteGoal(selected.id, goalId))
                            }
                          >
                            <Unlink size={14} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="note-plan-link-group">
                      <span>
                        <ListTodo size={12} aria-hidden="true" /> Actions
                      </span>
                      {knowledge?.actions.some(
                        (action) => !knowledge.actionLinks.includes(action.id)
                      ) ? (
                        <div className="note-inline-control">
                          <select
                            value={targetActionId}
                            onChange={(event) => setTargetActionId(event.target.value)}
                            aria-label="Action to connect"
                          >
                            <option value="">Choose an Action</option>
                            {knowledge.actions
                              .filter((action) => !knowledge.actionLinks.includes(action.id))
                              .map((action) => (
                                <option key={action.id} value={action.id}>
                                  {action.title}
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            disabled={!targetActionId || isPending}
                            onClick={() => {
                              const actionId = targetActionId;
                              runKnowledgeAction(async () => {
                                await linkNoteAction(selected.id, actionId);
                                setTargetActionId('');
                              });
                            }}
                          >
                            Link
                          </button>
                        </div>
                      ) : null}
                      {knowledge?.actionLinks.map((actionId) => (
                        <div key={actionId} className="note-plan-link-row">
                          <strong>
                            {knowledge.actions.find((action) => action.id === actionId)?.title ??
                              'Missing Action'}
                          </strong>
                          <button
                            type="button"
                            className="note-icon-quiet"
                            title="Remove Action link"
                            aria-label="Remove Action link"
                            onClick={() =>
                              runKnowledgeAction(() => unlinkNoteAction(selected.id, actionId))
                            }
                          >
                            <Unlink size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                    {!knowledge?.goalLinks.length && !knowledge?.actionLinks.length ? (
                      <p className="note-inspector-empty">No planning connections</p>
                    ) : null}
                  </div>
                </section>

                <section className="note-inspector-section" data-inspector-group="links">
                  <h2>
                    <Link2 size={15} aria-hidden="true" />
                    Links
                  </h2>
                  {availableTargets.length ? (
                    <div className="note-link-creator">
                      <select
                        value={targetNoteId}
                        onChange={(event) => setTargetNoteId(event.target.value)}
                        aria-label="Note to link"
                      >
                        <option value="">Choose a Note</option>
                        {availableTargets.map((note) => (
                          <option key={note.id} value={note.id}>
                            {note.title}
                          </option>
                        ))}
                      </select>
                      <select
                        value={relationType}
                        onChange={(event) =>
                          setRelationType(
                            event.target
                              .value as NoteKnowledgeContext['links'][number]['relationType']
                          )
                        }
                        aria-label="Link relationship"
                      >
                        <option value="related">Related</option>
                        <option value="supports">Supports</option>
                        <option value="contradicts">Contradicts</option>
                        <option value="continues">Continues</option>
                      </select>
                      <button
                        type="button"
                        disabled={!targetNoteId || isPending}
                        onClick={() => {
                          const target = targetNoteId;
                          runKnowledgeAction(async () => {
                            await linkNote({
                              sourceNoteId: selected.id,
                              targetNoteId: target,
                              relationType,
                            });
                            setTargetNoteId('');
                          });
                        }}
                      >
                        Add link
                      </button>
                    </div>
                  ) : null}
                  <div className="note-connection-list">
                    {knowledge?.links.map((link) => {
                      const outgoing = link.sourceNoteId === selected.id;
                      const relatedId = outgoing ? link.targetNoteId : link.sourceNoteId;
                      return (
                        <div key={link.id} className="note-connection-row">
                          <button
                            type="button"
                            className="note-connection-target"
                            onClick={() => router.push(`/notes?note=${relatedId}`)}
                          >
                            <span>
                              {outgoing ? link.relationType : `backlink · ${link.relationType}`}
                            </span>
                            <strong>{noteName(relatedId)}</strong>
                          </button>
                          <button
                            type="button"
                            className="note-icon-quiet"
                            title="Remove link"
                            aria-label={`Remove link to ${noteName(relatedId)}`}
                            onClick={() => runKnowledgeAction(() => unlinkNote(link.id))}
                          >
                            <Unlink size={14} />
                          </button>
                        </div>
                      );
                    })}
                    {!knowledge?.links.length ? (
                      <p className="note-inspector-empty">No links or backlinks</p>
                    ) : null}
                  </div>
                </section>

                <section className="note-inspector-section" data-inspector-group="history">
                  <h2>
                    <History size={15} aria-hidden="true" />
                    History
                  </h2>
                  <div className="note-history-list">
                    {knowledge?.revisions.map((revision) => (
                      <div key={revision.id} className="note-history-row">
                        <div>
                          <strong>Version {revision.sourceVersion}</strong>
                          <time dateTime={revision.createdAt}>
                            {new Intl.DateTimeFormat('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            }).format(new Date(revision.createdAt))}
                          </time>
                        </div>
                        <button
                          type="button"
                          className="note-icon-quiet"
                          title="Restore revision"
                          aria-label={`Restore version ${revision.sourceVersion}`}
                          onClick={() => {
                            if (!window.confirm(`Restore version ${revision.sourceVersion}?`))
                              return;
                            startTransition(async () => {
                              try {
                                const restored = await restoreNoteRevision({
                                  noteId: selected.id,
                                  revisionId: revision.id,
                                  expectedVersion: versionRef.current,
                                });
                                versionRef.current = restored.version;
                                setTitle(restored.title);
                                setBody(restored.bodyMarkdown);
                                router.refresh();
                              } catch (caught) {
                                setError(errorMessage(caught));
                              }
                            });
                          }}
                        >
                          <RotateCcw size={14} />
                        </button>
                      </div>
                    ))}
                    {!knowledge?.revisions.length ? (
                      <p className="note-inspector-empty">No earlier revisions</p>
                    ) : null}
                  </div>
                </section>

                <section className="note-inspector-section" data-inspector-group="links">
                  <h2>
                    <FileInput size={15} aria-hidden="true" />
                    File captures
                  </h2>
                  <div className="note-capture-list">
                    {knowledge?.captures.map((capture) => (
                      <div key={capture.id} className="note-capture-row">
                        <p>{capture.rawText}</p>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() =>
                            runKnowledgeAction(() => fileCaptureToNote(capture.id, selected.id))
                          }
                        >
                          File here
                        </button>
                      </div>
                    ))}
                    {!knowledge?.captures.length ? (
                      <p className="note-inspector-empty">Inbox is clear</p>
                    ) : null}
                  </div>
                </section>
              </aside>
            </div>
          </>
        ) : (
          <div className="note-empty">
            <span className="note-empty-mark" aria-hidden="true">
              <NotebookPen size={24} />
            </span>
            <p className="eyebrow">Your workspace</p>
            <h2>Start with a page that is yours</h2>
            <p>
              Write something new or bring a small Notion folder first. Everything stays reviewable
              before it becomes part of your workspace.
            </p>
            <div className="note-empty-actions">
              <button className="btn-primary" type="button" onClick={() => newNote(null)}>
                Create a Note
              </button>
              <button className="btn-secondary" type="button" onClick={onRequestImport}>
                Import your Notes
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
