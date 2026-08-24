'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  Archive,
  Bold,
  FileInput,
  Heading2,
  History,
  Eye,
  Italic,
  Link2,
  List,
  ListTodo,
  Plus,
  RotateCcw,
  Search,
  ShieldOff,
  Tags,
  Target,
  Unlink,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useRouter } from 'next/navigation';
import {
  archiveNote,
  createNote,
  fileCaptureToNote,
  linkNoteAction,
  linkNoteGoal,
  linkNote,
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
import { NoteImportDialog } from '@/components/note-import-dialog';

function flattenNotes(notes: NoteView[]) {
  const children = new Map<string | null, NoteView[]>();
  for (const note of notes) {
    const group = children.get(note.parentNoteId) ?? [];
    group.push(note);
    children.set(note.parentNoteId, group);
  }
  const output: Array<NoteView & { depth: number }> = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const note of children.get(parentId) ?? []) {
      output.push({ ...note, depth });
      visit(note.id, depth + 1);
    }
  };
  visit(null, 0);
  return output;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to save this Note.';
}

export function NotesWorkspace({
  notes,
  selectedId,
  query,
  knowledge,
  initialImportOpen = false,
}: {
  notes: NoteView[];
  selectedId: string | null;
  query: string;
  knowledge: NoteKnowledgeContext | null;
  initialImportOpen?: boolean;
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
  const [editorMode, setEditorMode] = useState<'edit' | 'preview'>('edit');
  const [importOpen, setImportOpen] = useState(initialImportOpen);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const initialRender = useRef(true);
  const tree = useMemo(() => flattenNotes(notes), [notes]);

  useEffect(() => {
    if (!activeNoteId) return;
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      void updateNote({
        id: activeNoteId,
        title: title.trim() || 'Untitled',
        bodyMarkdown: body,
        expectedVersion: versionRef.current,
      })
        .then((saved) => {
          versionRef.current = saved.version;
          setSaveState('saved');
          router.refresh();
        })
        .catch((caught) => {
          setError(errorMessage(caught));
          setSaveState('error');
        });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [activeNoteId, body, router, title]);

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
        router.refresh();
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
    setBody(`${body.slice(0, start)}${prefix}${body.slice(start, end)}${suffix}${body.slice(end)}`);
    window.requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(start + prefix.length, end + prefix.length);
    });
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

  const availableTargets = notes.filter((note) => note.id !== selected?.id);
  const noteName = (id: string) => notes.find((note) => note.id === id)?.title ?? 'Missing Note';

  return (
    <div className="notes-shell">
      <aside className="notes-sidebar">
        <div className="notes-sidebar-heading">
          <div>
            <p className="eyebrow">Vault</p>
            <h1>Notes</h1>
          </div>
          <div className="notes-sidebar-actions">
            <button
              className="icon-button"
              type="button"
              title="Import Notes"
              aria-label="Import Notes"
              onClick={() => setImportOpen(true)}
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
          {tree.map((note) => (
            <button
              key={note.id}
              className={`note-tree-item${note.id === selected?.id ? ' note-tree-item-active' : ''}`}
              style={{ paddingLeft: `${10 + Math.min(note.depth, 6) * 14}px` }}
              type="button"
              onClick={() => router.push(`/notes?note=${note.id}`)}
            >
              <span>{note.title}</span>
              {note.aiExcluded ? <ShieldOff size={13} aria-label="Excluded from AI" /> : null}
            </button>
          ))}
        </nav>
      </aside>

      <section className="note-editor-pane">
        {selected ? (
          <>
            <div className="note-editor-header">
              <input
                className="note-title-input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                aria-label="Note title"
                maxLength={300}
              />
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
            <div className="markdown-toolbar" role="toolbar" aria-label="Markdown formatting">
              <div className="markdown-tools">
                <button
                  type="button"
                  title="Heading"
                  aria-label="Heading"
                  onClick={() => wrapSelection('## ', '')}
                  disabled={editorMode === 'preview'}
                >
                  <Heading2 size={16} />
                </button>
                <button
                  type="button"
                  title="Bold"
                  aria-label="Bold"
                  onClick={() => wrapSelection('**')}
                  disabled={editorMode === 'preview'}
                >
                  <Bold size={16} />
                </button>
                <button
                  type="button"
                  title="Italic"
                  aria-label="Italic"
                  onClick={() => wrapSelection('_')}
                  disabled={editorMode === 'preview'}
                >
                  <Italic size={16} />
                </button>
                <button
                  type="button"
                  title="List"
                  aria-label="List"
                  onClick={() => wrapSelection('- ', '')}
                  disabled={editorMode === 'preview'}
                >
                  <List size={16} />
                </button>
              </div>
              <div className="editor-mode-control" aria-label="Editor mode">
                <button
                  type="button"
                  className={editorMode === 'edit' ? 'editor-mode-active' : undefined}
                  aria-pressed={editorMode === 'edit'}
                  onClick={() => setEditorMode('edit')}
                >
                  <FileInput size={14} />
                  Edit
                </button>
                <button
                  type="button"
                  className={editorMode === 'preview' ? 'editor-mode-active' : undefined}
                  aria-pressed={editorMode === 'preview'}
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
            </div>
            <div className="note-content-layout">
              {editorMode === 'edit' ? (
                <textarea
                  ref={editorRef}
                  className="markdown-editor"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Write in Markdown..."
                  spellCheck
                />
              ) : (
                <article className="markdown-preview">
                  {body ? (
                    <ReactMarkdown
                      components={{
                        a: ({ children, ...props }) => (
                          <a {...props} rel="noreferrer" target="_blank">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {body}
                    </ReactMarkdown>
                  ) : (
                    <p className="note-inspector-empty">Nothing to preview</p>
                  )}
                </article>
              )}
              <aside className="note-inspector" aria-label="Note connections and history">
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
      <NoteImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onCompleted={() => router.refresh()}
      />
    </div>
  );
}
