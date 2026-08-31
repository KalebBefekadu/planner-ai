'use client';

import { useState, useTransition } from 'react';
import { RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { emptyEligibleTrashAction, restoreTrashBatchAction } from '@/app/trash/actions';

export type TrashBatchView = {
  id: string;
  root_item_type: string;
  root_label: string;
  created_at: string;
  affectedCount: number;
  /* Decided on the server. Comparing against Date.now() during render is
     impure and can hydrate differently than it rendered. */
  emptyEligible: boolean;
};

export function TrashManager({ batches }: { batches: TrashBatchView[] }) {
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function restore(batchId: string) {
    startTransition(async () => {
      const result = await restoreTrashBatchAction(batchId);
      if (!result.ok) setError(result.error ?? 'Restore failed.');
      else {
        setError(null);
        setNotice('Trash batch restored.');
      }
    });
  }

  function emptyTrash() {
    startTransition(async () => {
      const result = await emptyEligibleTrashAction(confirmation);
      if (!result.ok) setError(result.error ?? 'Permanent deletion failed.');
      else {
        setConfirmation('');
        setError(null);
        setNotice('Eligible Trash permanently deleted.');
      }
    });
  }

  return (
    <div className="trash-layout">
      {notice ? (
        <p className="status-message" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="trash-list" aria-label="Recoverable Trash">
        {batches.length ? (
          batches.map((batch) => {
            const eligibleAt = new Date(new Date(batch.created_at).getTime() + 30 * 86_400_000);
            return (
              <article className="trash-row" key={batch.id}>
                <span className="trash-icon">
                  <Trash2 size={16} aria-hidden="true" />
                </span>
                <div>
                  <h2>{batch.root_label}</h2>
                  <p>
                    {batch.root_item_type} · {batch.affectedCount} item
                    {batch.affectedCount === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="trash-meta">
                  {/* Nothing is deleted on a timer — this date is when the item
                      becomes eligible to be emptied, not when it disappears.
                      "Permanent deletion available" read like a feature
                      unlocking, on a screen whose job is reassurance. */}
                  <span>
                    {batch.emptyEligible
                      ? 'Old enough to be emptied'
                      : 'Held until you empty Trash'}
                    {' · '}
                    {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(eligibleAt)}
                  </span>
                  <button
                    className="icon-button"
                    type="button"
                    title="Restore Trash batch"
                    aria-label={`Restore ${batch.root_label}`}
                    disabled={pending}
                    onClick={() => restore(batch.id)}
                  >
                    <RotateCcw size={16} />
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <p className="empty-copy">Trash is empty.</p>
        )}
      </section>
      <section className="settings-section empty-trash-section">
        <div>
          <ShieldAlert size={19} aria-hidden="true" />
          <div>
            <h2>Permanent deletion</h2>
            <p>Only batches held for at least 30 days are eligible.</p>
          </div>
        </div>
        <input
          className="input-field"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder="EMPTY TRASH"
          aria-label="Permanent deletion confirmation"
        />
        <button
          className="btn-primary button-with-icon"
          type="button"
          disabled={pending || confirmation !== 'EMPTY TRASH'}
          onClick={emptyTrash}
        >
          <Trash2 size={15} />
          Empty eligible Trash
        </button>
      </section>
    </div>
  );
}
