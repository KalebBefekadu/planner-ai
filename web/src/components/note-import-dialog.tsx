'use client';

import { useEffect, useRef, useState } from 'react';
import { Archive, Check, FileStack, FolderOpen, Loader2, X } from 'lucide-react';
import { commitNoteImport } from '@/app/notes/actions';
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
  onCompleted: () => void;
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
      const formData = new FormData();
      for (const file of selected) formData.append('files', file);
      formData.set(
        'paths',
        JSON.stringify(selected.map((file) => file.webkitRelativePath || file.name))
      );
      formData.set('sourceType', sourceType);
      const response = await fetch('/api/note-import', { method: 'POST', body: formData });
      const payload = (await response.json()) as ImportPreview | { error?: string };
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
        setPreview((value) => (value ? { ...value, job: current } : value));
      }
      if (current.status !== 'completed') throw new Error('Import paused before completion.');
      onCompleted();
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
                : 'ZIP, Markdown, text, and CSV'}
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
