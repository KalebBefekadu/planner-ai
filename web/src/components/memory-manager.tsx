'use client';

import { useState, useTransition } from 'react';
import { Brain, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import {
  createMemoryAction,
  trashMemoryAction,
  updateMemoryAction,
} from '@/app/settings/memory/actions';

export type MemoryView = {
  id: string;
  statement: string;
  source_type: string;
  source_id: string | null;
  version: number;
  updated_at: string;
};

export function MemoryManager({ memories }: { memories: MemoryView[] }) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<MemoryView | null>(null);
  const [editText, setEditText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function sourceHref(memory: MemoryView) {
    if (!memory.source_id) return null;
    if (memory.source_type === 'conversation') {
      return `/?conversation=${encodeURIComponent(memory.source_id)}`;
    }
    if (memory.source_type === 'note') {
      return `/notes?note=${encodeURIComponent(memory.source_id)}`;
    }
    if (memory.source_type === 'capture') return '/inbox';
    if (memory.source_type === 'review') return '/review';
    return null;
  }

  function createMemory() {
    if (!draft.trim()) return;
    startTransition(async () => {
      const result = await createMemoryAction(draft);
      if (!result.ok) setError(result.error ?? 'Memory could not be saved.');
      else {
        setDraft('');
        setError(null);
      }
    });
  }

  function saveEdit() {
    if (!editing || !editText.trim()) return;
    startTransition(async () => {
      const result = await updateMemoryAction(editing.id, editText, editing.version);
      if (!result.ok) setError(result.error ?? 'Memory could not be updated.');
      else {
        setEditing(null);
        setEditText('');
        setError(null);
      }
    });
  }

  function removeMemory(memory: MemoryView) {
    startTransition(async () => {
      const result = await trashMemoryAction(memory.id, memory.version);
      if (!result.ok) setError(result.error ?? 'Memory could not be removed.');
      else setError(null);
    });
  }

  return (
    <div className="memory-layout">
      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="settings-section memory-create">
        <div>
          <Brain size={19} aria-hidden="true" />
          <div>
            <h2>New Memory</h2>
            <p>Only explicit Memories are included in long-term assistant context.</p>
          </div>
        </div>
        <textarea
          className="input-field"
          value={draft}
          maxLength={2_000}
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="New Memory"
        />
        <button
          className="btn-primary button-with-icon"
          type="button"
          disabled={pending || !draft.trim()}
          onClick={createMemory}
        >
          <Plus size={15} />
          Add Memory
        </button>
      </section>
      <section className="memory-list" aria-label="Assistant Memories">
        {memories.length ? (
          memories.map((memory) => (
            <article className="memory-row" key={memory.id}>
              {editing?.id === memory.id ? (
                <textarea
                  className="input-field"
                  value={editText}
                  maxLength={2_000}
                  rows={3}
                  onChange={(event) => setEditText(event.target.value)}
                  aria-label="Edit Memory"
                />
              ) : (
                <div>
                  <p>{memory.statement}</p>
                  <span>
                    Source: <span className="enum-label">{memory.source_type}</span>
                    {sourceHref(memory) ? (
                      <>
                        {' '}
                        · <Link href={sourceHref(memory)!}>Open source</Link>
                      </>
                    ) : null}{' '}
                    · updated{' '}
                    {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(
                      new Date(memory.updated_at)
                    )}
                  </span>
                </div>
              )}
              <div>
                {editing?.id === memory.id ? (
                  <>
                    <button
                      className="icon-button"
                      type="button"
                      title="Cancel editing"
                      aria-label="Cancel editing"
                      onClick={() => setEditing(null)}
                    >
                      <X size={16} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="Save Memory"
                      aria-label="Save Memory"
                      disabled={pending || !editText.trim()}
                      onClick={saveEdit}
                    >
                      <Check size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="icon-button"
                      type="button"
                      title="Edit Memory"
                      aria-label="Edit Memory"
                      onClick={() => {
                        setEditing(memory);
                        setEditText(memory.statement);
                      }}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="Move Memory to Trash"
                      aria-label="Move Memory to Trash"
                      disabled={pending}
                      onClick={() => removeMemory(memory)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </div>
            </article>
          ))
        ) : (
          <p className="empty-copy">No long-term assistant Memories.</p>
        )}
      </section>
    </div>
  );
}
