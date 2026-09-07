'use client';

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Bold,
  FileText,
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
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  ShieldOff,
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
  moveNoteToNewParent,
  moveNoteWithinParent,
  restoreNoteRevision,
  setNoteTags,
  setNoteAiExcluded,
  unlinkNote,
  unlinkNoteAction,
  unlinkNoteGoal,
  updateNote,
  type NoteKnowledgeContext,
  type NoteView,
} from '@/app/notes/actions';
import { nextParentMove, nextSiblingMove } from '@/lib/notes/sibling-order';
import { RichMarkdownEditor } from '@/components/rich-markdown-editor';
import { useVoiceTranscription } from '@/lib/use-voice-transcription';
import { extractPlannerMarkdownHeadings } from '@/lib/markdown/contract';
import { continueMarkdownList, wrapMarkdownSelection } from '@/lib/markdown/editing';
import { plannerMarkdownSupportsRichEditing } from '@/lib/markdown/rich-editor';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to save this Note.';
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

export function NotesWorkspace({
  notes,
  selectedId,
  query,
  knowledge,
  onRequestImport,
}: {
  notes: NoteView[];
  selectedId: string | null;
  query: string;
  knowledge: NoteKnowledgeContext | null;
  onRequestImport: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const selected = notes.find((note) => note.id === selectedId) ?? null;
  const activeNoteId = selected?.id ?? null;
  const [title, setTitle] = useState(selected?.title ?? '');
  const [body, setBody] = useState(selected?.bodyMarkdown ?? '');
  const versionRef = useRef(selected?.version ?? 1);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [error, setError] = useState<string | null>(null);
  const [tagText, setTagText] = useState(knowledge?.tags.join(', ') ?? '');
  const [targetNoteId, setTargetNoteId] = useState('');
  const [targetGoalId, setTargetGoalId] = useState('');
  const [targetActionId, setTargetActionId] = useState('');
  const [relationType, setRelationType] =
    useState<NoteKnowledgeContext['links'][number]['relationType']>('related');
  const [editorMode, setEditorMode] = useState<'source' | 'rich' | 'preview'>('source');
  const [richEditor, setRichEditor] = useState<Editor | null>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [recentlyRemovedAttachment, setRecentlyRemovedAttachment] = useState<{
    id: string;
    originalName: string;
  } | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const persistedDraftRef = useRef({
    title: selected?.title ?? '',
    bodyMarkdown: selected?.bodyMarkdown ?? '',
  });
  const saveInFlightRef = useRef(false);
  const queuedDraftRef = useRef<{ title: string; bodyMarkdown: string } | null>(null);
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
  function renderNoteLevel(parentNoteId: string | null) {
    const level = notes
      .filter((note) => note.parentNoteId === parentNoteId)
      .sort((first, second) => first.sortKey - second.sortKey);
    if (!level.length) return null;
    return (
      <ul className="note-tree-level">
        {level.map((note) => (
          <li key={note.id}>
            <button
              className={`note-tree-item${note.id === selected?.id ? ' note-tree-item-active' : ''}`}
              type="button"
              onClick={() => router.push(`/notes?note=${note.id}`)}
            >
              <span>{note.title}</span>
              {note.aiExcluded ? <ShieldOff size={13} aria-label="Excluded from AI" /> : null}
            </button>
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

  const queueAutosave = useCallback(
    async (draft: { title: string; bodyMarkdown: string }) => {
      if (!activeNoteId) return;
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
              id: activeNoteId,
              title: nextDraft.title.trim() || 'Untitled',
              bodyMarkdown: nextDraft.bodyMarkdown,
              expectedVersion: versionRef.current,
            });
            versionRef.current = saved.version;
            persistedDraftRef.current = nextDraft;
          } catch (caught) {
            queuedDraftRef.current ??= nextDraft;
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
    [activeNoteId, router]
  );

  useEffect(() => {
    if (!activeNoteId) return;
    if (
      persistedDraftRef.current.title === title &&
      persistedDraftRef.current.bodyMarkdown === body
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void queueAutosave({ title, bodyMarkdown: body });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [activeNoteId, body, queueAutosave, title]);

  useEffect(() => {
    if (selected?.version && selected.version > versionRef.current) {
      versionRef.current = selected.version;
    }
  }, [selected?.version]);

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
      const removed = knowledge?.attachments.find((attachment) => attachment.id === attachmentId);
      if (removed) {
        setRecentlyRemovedAttachment({ id: removed.id, originalName: removed.originalName });
      }
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
      setRecentlyRemovedAttachment(null);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsUploadingAttachment(false);
    }
  }

  const availableTargets = notes.filter((note) => note.id !== selected?.id);
  const noteName = (id: string) => notes.find((note) => note.id === id)?.title ?? 'Missing Note';

  return (
    <div className="notes-shell">
      <aside className="notes-sidebar">
        <div className="notes-sidebar-heading">
          <div>
            <p className="eyebrow">Vault</p>
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
        <nav className="note-tree" aria-label="Notes">
          {renderNoteLevel(null)}
        </nav>
      </aside>

      <section className="note-editor-pane">
        {selected ? (
          <>
            <div className="note-editor-header">
              <div className="note-title-group">
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
                      : 'Saved'}
                </span>
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
              <aside className="note-inspector" aria-label="Note connections and history">
                <section className="note-inspector-section">
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
                          style={{ paddingLeft: `${Math.min(heading.depth - 1, 4) * 12}px` }}
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
                <section className="note-inspector-section">
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
                    {knowledge?.attachments.map((attachment) => (
                      <div key={attachment.id} className="note-attachment-row">
                        <div>
                          <strong>{attachment.originalName}</strong>
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
                        </div>
                        <span>
                          {attachment.scanState === 'quarantined'
                            ? 'Security review pending'
                            : attachment.scanState}
                        </span>
                      </div>
                    ))}
                    {!knowledge?.attachments.length ? (
                      <p className="note-inspector-empty">No attachments</p>
                    ) : null}
                    {recentlyRemovedAttachment ? (
                      <div className="note-attachment-row">
                        <span>{recentlyRemovedAttachment.originalName} removed</span>
                        <button
                          type="button"
                          className="note-icon-quiet"
                          title="Restore attachment"
                          aria-label={`Restore attachment ${recentlyRemovedAttachment.originalName}`}
                          disabled={isUploadingAttachment}
                          onClick={() => void restoreAttachment(recentlyRemovedAttachment.id)}
                        >
                          <RotateCcw size={14} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="note-inspector-section">
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

                <section className="note-inspector-section">
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

                <section className="note-inspector-section">
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

                <section className="note-inspector-section">
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

                <section className="note-inspector-section">
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
            <h2>No Note selected</h2>
            <button className="btn-primary" type="button" onClick={() => newNote(null)}>
              Create a Note
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
