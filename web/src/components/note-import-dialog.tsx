'use client';

import { useEffect, useRef, useState } from 'react';
import { Archive, Check, FileStack, FolderOpen, Loader2, X } from 'lucide-react';
import { commitNoteImport } from '@/app/notes/actions';
import {
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

type ImportPreview = {
  job: {
    id: string;
    sourceName: string;
    sourceType: 'notion' | 'obsidian' | 'generic';
    status: 'preview' | 'committing' | 'completed';
    totalCount: number;
    createCount: number;
    duplicateCount: number;
    unsupportedCount: number;
    committedCount: number;
  };
  items: ImportItem[];
};

function messageFrom(error: unknown) {
  return actionFailureMessage(error, 'Planner AI could not import these Notes.');
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
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    directoryInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void fetch('/api/note-import', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as ImportPreview | null;
      })
      .then((saved) => {
        if (active && saved) {
          setPreview(saved);
          setSourceType(saved.job.sourceType);
        }
      })
      .catch(() => undefined);
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
        | ImportPreview
        | { error?: string }
        | null;
      if (!payload) {
        throw new Error(
          response.status === 413
            ? IMPORT_TOO_LARGE_MESSAGE
            : 'Planner AI could not read the import response. Nothing was imported.'
        );
      }
      if (!response.ok || !('job' in payload)) {
        throw new Error('error' in payload && payload.error ? payload.error : 'Import failed.');
      }
      setPreview(payload);
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
  async function reloadReport(jobId: string) {
    const response = await fetch(`/api/note-import?jobId=${encodeURIComponent(jobId)}`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return (await response.json()) as ImportPreview | null;
  }

  async function commit() {
    if (!preview || preview.job.status === 'completed') return;
    setBusy(true);
    setError(null);
    try {
      let current = preview.job;
      for (let batch = 0; current.status !== 'completed' && batch < 12; batch += 1) {
        const next = await commitNoteImport(current.id, 50);
        if (next.status !== 'completed' && next.committedCount <= current.committedCount) {
          throw new Error('Import could not make progress. No Notes were duplicated.');
        }
        current = { ...current, ...next };
        const committed = await reloadReport(current.id).catch(() => null);
        if (committed) {
          current = committed.job;
          setPreview(committed);
        } else {
          // The commit itself succeeded; only the re-read failed. Keep the
          // counts truthful rather than discarding them.
          const job = current;
          setPreview((value) => (value ? { ...value, job } : value));
        }
      }
      if (current.status !== 'completed') throw new Error('Import paused before completion.');
      onCompleted?.();
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  const remaining = preview ? preview.job.createCount - preview.job.committedCount : 0;

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

        {preview ? (
          <div className="note-import-preview">
            <div className="note-import-summary" aria-label="Import summary">
              <div>
                <strong>{preview.job.createCount}</strong>
                <span>New</span>
              </div>
              <div>
                <strong>{preview.job.duplicateCount}</strong>
                <span>Duplicates</span>
              </div>
              <div>
                <strong>{preview.job.unsupportedCount}</strong>
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

        <footer>
          <span className="note-import-footnote">
            {preview?.job.status === 'completed'
              ? `${preview.job.committedCount} Notes imported`
              : preview
                ? 'Preview only. Your Notes are unchanged.'
                : `ZIP, Markdown, text, and CSV — up to ${IMPORT_UPLOAD_LIMIT_LABEL} per import`}
          </span>
          {preview?.job.status === 'completed' ? (
            <button className="btn-primary" type="button" onClick={onClose}>
              <Check size={16} /> Done
            </button>
          ) : (
            <button
              className="btn-primary"
              type="button"
              onClick={() => void commit()}
              disabled={!preview || !remaining || busy}
            >
              Import {remaining || ''}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
