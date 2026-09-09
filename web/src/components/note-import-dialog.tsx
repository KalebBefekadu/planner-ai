'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Ban, Check, FileStack, FolderOpen, History, Loader2, X } from 'lucide-react';
import { commitNoteImport } from '@/app/notes/actions';
import {
  IMPORT_BATCH_CEILING_MESSAGE,
  IMPORT_COMMIT_BATCH_CEILING,
  IMPORT_COMMIT_BATCH_SIZE,
  IMPORT_LIMITS,
  IMPORT_TOO_LARGE_MESSAGE,
  IMPORT_UPLOAD_LIMIT_LABEL,
} from '@/lib/notes/import-limits';
import { actionFailureMessage } from '@/lib/operations/failure-message';

type ImportItem = {
  id: string;
  sourcePath: string;
  parentSourcePath: string | null;
  title: string;
  disposition: 'create' | 'skip_duplicate' | 'unsupported';
  reason: string | null;
  imported: boolean;
};

type ImportJob = {
  id: string;
  sourceName: string;
  sourceType: 'notion' | 'obsidian' | 'generic';
  status: 'preview' | 'committing' | 'completed' | 'canceled';
  totalCount: number;
  createCount: number;
  duplicateCount: number;
  unsupportedCount: number;
  committedCount: number;
};

type HistoryEntry = ImportJob & { createdAt: string; completedAt: string | null };

type ImportHistory = { entries: HistoryEntry[]; nextCursor: string | null };

type ImportReport = {
  job: ImportJob | null;
  items: ImportItem[];
  history?: ImportHistory;
};

function messageFrom(error: unknown) {
  return actionFailureMessage(error, 'Planner AI could not import these Notes.');
}

function describeEntry(entry: HistoryEntry) {
  if (entry.status === 'completed') {
    return `${entry.committedCount} of ${entry.createCount} Notes imported`;
  }
  if (entry.status === 'canceled') return 'Canceled';
  if (entry.committedCount > 0) {
    return `Interrupted after ${entry.committedCount} of ${entry.createCount} Notes`;
  }
  return 'Waiting for review';
}

function formatWhen(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function NoteImportDialog({
  open,
  onClose,
  onCompleted,
}: {
  open: boolean;
  onClose: () => void;
  onCompleted?: () => void;
}) {
  const directoryInput = useRef<HTMLInputElement>(null);
  const [sourceType, setSourceType] = useState<'notion' | 'obsidian' | 'generic'>('notion');
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [history, setHistory] = useState<ImportHistory | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    directoryInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  // A modal that only closes by pointer is unusable by keyboard alone, and the
  // import dialog is the one place a keyboard user most needs a way out.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void fetch('/api/note-import', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as ImportReport | null;
      })
      .then((saved) => {
        if (!active) return;
        // History is set even when it comes back empty, because "no past
        // imports" and "still looking" are different things to show.
        setHistory(saved?.history ?? { entries: [], nextCursor: null });
        if (!saved) return;
        // An unfinished job is returned by default, so closing the browser
        // mid-import leaves the owner exactly where they were rather than
        // stranding half a migration with no way back to it.
        if (saved.job) {
          setPreview(saved);
          setSourceType(saved.job.sourceType);
        }
      })
      .catch(() => {
        if (active) setHistory({ entries: [], nextCursor: null });
      });
    return () => {
      active = false;
    };
  }, [open]);

  async function inspect(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const selected = Array.from(files);
      // The deployment rejects an oversized body at the edge, so the browser
      // would get a response this dialog cannot read and the person would see
      // a generic failure after waiting for a doomed upload. Checking the
      // selection here turns that into an immediate, actionable answer, and
      // the server still enforces the same bound for anything not sent by
      // this dialog.
      const selectedBytes = selected.reduce((total, file) => total + file.size, 0);
      if (selectedBytes > IMPORT_LIMITS.archiveBytes) {
        throw new Error(IMPORT_TOO_LARGE_MESSAGE);
      }
      if (selected.length > IMPORT_LIMITS.candidates) {
        throw new Error(
          `Choose at most ${IMPORT_LIMITS.candidates} files at a time. Nothing was imported.`
        );
      }
      const formData = new FormData();
      for (const file of selected) formData.append('files', file);
      formData.set(
        'paths',
        JSON.stringify(selected.map((file) => file.webkitRelativePath || file.name))
      );
      formData.set('sourceType', sourceType);
      const response = await fetch('/api/note-import', { method: 'POST', body: formData });
      // A body rejected by the hosting platform never reaches the route, and
      // what comes back is not this application's JSON. Say what actually
      // happened instead of letting the JSON parse fail into "Import failed".
      const payload = (await response.json().catch(() => null)) as
        | ImportReport
        | { error?: string }
        | null;
      if (!payload) {
        throw new Error(
          response.status === 413
            ? IMPORT_TOO_LARGE_MESSAGE
            : 'Planner AI could not read the import response. Nothing was imported.'
        );
      }
      if (!response.ok || !('job' in payload) || !payload.job) {
        throw new Error('error' in payload && payload.error ? payload.error : 'Import failed.');
      }
      setPreview(payload);
      if (payload.history) setHistory(payload.history);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  // The per-item report is the reconciliation surface: it is how the owner
  // decides whether a migration lost anything. Re-reading the job after a
  // batch is what makes each row describe the committed record rather than
  // the preview that was taken before any Note existed.
  const reloadReport = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/note-import?jobId=${encodeURIComponent(jobId)}`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as ImportReport | null;
    return payload?.job ? payload : null;
  }, []);

  // Reopening a finished report is a read, so it must never disturb a job that
  // is still in flight. Refusing while a commit is running keeps the open
  // report and the batch loop from describing two different jobs at once.
  async function openReport(jobId: string) {
    if (busy) return;
    setHistoryBusy(true);
    setError(null);
    try {
      const report = await reloadReport(jobId);
      if (!report) throw new Error('That import report is no longer available.');
      setPreview(report);
      setSourceType(report.job!.sourceType);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setHistoryBusy(false);
    }
  }

  async function loadMoreHistory() {
    if (!history?.nextCursor || historyBusy) return;
    setHistoryBusy(true);
    try {
      const response = await fetch(
        `/api/note-import?historyBefore=${encodeURIComponent(history.nextCursor)}`,
        { cache: 'no-store' }
      );
      if (!response.ok) return;
      const payload = (await response.json()) as ImportReport | null;
      if (!payload?.history) return;
      const next = payload.history;
      setHistory((value) =>
        value ? { entries: [...value.entries, ...next.entries], nextCursor: next.nextCursor } : next
      );
    } catch {
      setError('Older imports could not be loaded.');
    } finally {
      setHistoryBusy(false);
    }
  }

  async function commit() {
    const job = preview?.job;
    if (!job || job.status === 'completed' || job.status === 'canceled') return;
    setBusy(true);
    setError(null);
    try {
      let current = job;
      for (
        let batch = 0;
        current.status !== 'completed' && batch < IMPORT_COMMIT_BATCH_CEILING;
        batch += 1
      ) {
        const next = await commitNoteImport(current.id, IMPORT_COMMIT_BATCH_SIZE);
        if (next.status !== 'completed' && next.committedCount <= current.committedCount) {
          throw new Error('Import could not make progress. No Notes were duplicated.');
        }
        current = { ...current, ...next };
        const committed = await reloadReport(current.id).catch(() => null);
        if (committed?.job) {
          current = committed.job;
          setPreview(committed);
        } else {
          // The commit itself succeeded; only the re-read failed. Keep the
          // counts truthful rather than discarding them.
          const job = current;
          setPreview((value) => (value ? { ...value, job } : value));
        }
      }
      if (current.status !== 'completed') throw new Error(IMPORT_BATCH_CEILING_MESSAGE);
      onCompleted?.();
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  // Closing the dialog says nothing about the import. Saying no is a decision,
  // and it has to be the owner's to make rather than inferred from a dismissed
  // window -- otherwise an abandoned preview comes back as the active job and
  // presents itself as work still to do.
  async function cancelImport() {
    const job = preview?.job;
    if (!job || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/note-import?jobId=${encodeURIComponent(job.id)}`, {
        method: 'DELETE',
      });
      const payload = (await response.json().catch(() => null)) as
        | ImportReport
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          payload && 'error' in payload && payload.error
            ? payload.error
            : 'This import could not be canceled.'
        );
      }
      if (payload && 'job' in payload) {
        setPreview(payload.job ? payload : null);
        if (payload.history) setHistory(payload.history);
      }
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  const job = preview?.job ?? null;
  const remaining = job ? job.createCount - job.committedCount : 0;
  const resumable = Boolean(job) && job!.status !== 'completed' && job!.status !== 'canceled';
  const partiallyCommitted = Boolean(job && job.committedCount > 0 && resumable);
  // Cancelling is not undoing. Once a Note exists the workspace has changed,
  // and the way back from that is undo, not a decision not to start.
  const cancelable = Boolean(job) && resumable && job!.committedCount === 0;
  const historyEntries = history?.entries ?? [];

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="note-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">Notes migration</p>
            <h2 id="note-import-title">Import Notes</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close import" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="note-import-source">
          <label>
            Source
            <select
              value={sourceType}
              onChange={(event) =>
                setSourceType(event.target.value as 'notion' | 'obsidian' | 'generic')
              }
              disabled={busy}
            >
              <option value="notion">Notion export</option>
              <option value="obsidian">Obsidian vault</option>
              <option value="generic">Markdown or CSV</option>
            </select>
          </label>
          <div className="note-import-pickers">
            <label className="note-import-picker">
              <Archive size={18} aria-hidden="true" />
              <span>Archive or files</span>
              <input
                className="visually-hidden"
                type="file"
                accept=".zip,.md,.markdown,.txt,.csv"
                multiple
                disabled={busy}
                onChange={(event) => void inspect(event.target.files)}
              />
            </label>
            <label className="note-import-picker">
              <FolderOpen size={18} aria-hidden="true" />
              <span>Folder</span>
              <input
                ref={directoryInput}
                className="visually-hidden"
                type="file"
                multiple
                disabled={busy}
                onChange={(event) => void inspect(event.target.files)}
              />
            </label>
          </div>
        </div>

        {busy ? (
          <div className="note-import-loading" role="status">
            <Loader2 size={17} className="spin-icon" />
            {preview ? 'Importing Notes' : 'Inspecting files'}
          </div>
        ) : null}
        {error ? (
          <p className="status-message status-message-error" role="alert">
            {error}
          </p>
        ) : null}

        {partiallyCommitted ? (
          <p className="status-message" role="status">
            {job!.committedCount} of {job!.createCount} Notes were already imported from{' '}
            {job!.sourceName}. Resuming finishes the rest and never re-creates a Note that already
            exists.
          </p>
        ) : null}

        {preview && job ? (
          <div className="note-import-preview">
            <div className="note-import-summary" aria-label="Import summary">
              <div>
                <strong>{job.createCount}</strong>
                <span>New</span>
              </div>
              <div>
                <strong>{job.duplicateCount}</strong>
                <span>Duplicates</span>
              </div>
              <div>
                <strong>{job.unsupportedCount}</strong>
                <span>Unsupported</span>
              </div>
            </div>
            <div className="note-import-list" aria-label="Import preview">
              {preview.items.map((item) => (
                <div key={item.id} className="note-import-row">
                  <FileStack size={15} aria-hidden="true" />
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.sourcePath}</span>
                    {item.reason ? <small>{item.reason}</small> : null}
                  </div>
                  <span className={`note-import-disposition disposition-${item.disposition}`}>
                    {item.imported
                      ? 'Imported'
                      : item.disposition === 'create'
                        ? 'New'
                        : item.disposition === 'skip_duplicate'
                          ? 'Duplicate'
                          : 'Unsupported'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {historyEntries.length ? (
          <section className="note-import-history" aria-labelledby="note-import-history-title">
            <h3 id="note-import-history-title">
              <History size={15} aria-hidden="true" /> Past imports
            </h3>
            <ul>
              {historyEntries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="note-import-history-entry"
                    aria-current={job?.id === entry.id ? 'true' : undefined}
                    disabled={busy}
                    onClick={() => void openReport(entry.id)}
                  >
                    <strong>{entry.sourceName}</strong>
                    <span>{describeEntry(entry)}</span>
                    <small>{formatWhen(entry.createdAt)}</small>
                  </button>
                </li>
              ))}
            </ul>
            {history?.nextCursor ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={historyBusy}
                onClick={() => void loadMoreHistory()}
              >
                Show older imports
              </button>
            ) : null}
          </section>
        ) : history === null ? (
          <p className="note-import-history-empty" role="status">
            Looking for past imports
          </p>
        ) : (
          <p className="note-import-history-empty">
            Past imports appear here so you can reopen a report later.
          </p>
        )}

        <footer>
          <span className="note-import-footnote">
            {job?.status === 'completed'
              ? `${job.committedCount} Notes imported`
              : partiallyCommitted
                ? // Saying "your Notes are unchanged" once a batch has committed
                  // would be false, and this is the moment the owner is deciding
                  // whether it is safe to press the button again.
                  `${job!.committedCount} already imported. ${remaining} left.`
                : job
                  ? 'Preview only. Your Notes are unchanged.'
                  : `ZIP, Markdown, text, and CSV — up to ${IMPORT_UPLOAD_LIMIT_LABEL} per import`}
          </span>
          {job?.status === 'completed' || job?.status === 'canceled' ? (
            <button className="btn-primary" type="button" onClick={onClose}>
              <Check size={16} /> Done
            </button>
          ) : (
            <>
              {cancelable ? (
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => void cancelImport()}
                  disabled={busy}
                >
                  <Ban size={16} /> Don&rsquo;t import
                </button>
              ) : null}
              <button
                className="btn-primary"
                type="button"
                onClick={() => void commit()}
                disabled={!job || !remaining || busy}
              >
                {partiallyCommitted ? 'Resume' : 'Import'} {remaining || ''}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
