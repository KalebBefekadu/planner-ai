'use client';

import { conflictSummary, describeNoteConflict } from '@/lib/notes/conflict-resolution';
import type { useNoteDraft } from '@/lib/notes/use-note-draft';

type NoteDraftState = ReturnType<typeof useNoteDraft>;

export function NoteConflictPanel({
  conflict,
  onResolve,
}: {
  conflict: NonNullable<NoteDraftState['conflict']>;
  onResolve: NoteDraftState['resolveConflict'];
}) {
  const comparison = describeNoteConflict(conflict.mine, conflict.theirs);
  return (
    <section className="note-conflict" role="alert" aria-label="Version conflict">
      <p className="note-conflict-summary">{conflictSummary(comparison)}</p>
      <p className="note-conflict-help">
        Your writing is safe. Read both, then choose which one this Note keeps.
      </p>
      {comparison.titleDiffers ? (
        <dl className="note-conflict-titles">
          <dt>Your title</dt>
          <dd>{conflict.mine.title || 'Untitled'}</dd>
          <dt>Saved title</dt>
          <dd>{conflict.theirs.title || 'Untitled'}</dd>
        </dl>
      ) : null}
      {comparison.bodyDiffers ? (
        <ol className="note-conflict-diff">
          {comparison.lines.map((line, index) => (
            <li
              key={`${line.kind}-${index}`}
              className={`note-conflict-line note-conflict-line-${line.kind}`}
            >
              <span className="note-conflict-marker" aria-hidden="true">
                {line.kind === 'mine' ? '+' : line.kind === 'theirs' ? '−' : ' '}
              </span>
              <span className="note-conflict-side">
                {line.kind === 'mine' ? 'Yours: ' : line.kind === 'theirs' ? 'Saved: ' : ''}
              </span>
              <span className="note-conflict-text">{line.text || ' '}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="note-conflict-actions">
        <button className="btn-primary" type="button" onClick={() => void onResolve('mine')}>
          Keep what I wrote
        </button>
        <button className="btn-secondary" type="button" onClick={() => void onResolve('theirs')}>
          Use the saved version
        </button>
      </div>
    </section>
  );
}

export function NoteDraftRecoveryPanel({
  draft,
  onRestore,
  onDiscard,
}: {
  draft: NonNullable<NoteDraftState['recoverableDraft']>;
  onRestore: NoteDraftState['restoreDraft'];
  onDiscard: NoteDraftState['dismissRecoverableDraft'];
}) {
  return (
    <section className="note-draft-recovery" aria-label="Recover unsaved changes">
      <p>
        Unsaved changes from{' '}
        {new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(draft.savedAt))}{' '}
        were kept on this device because a save did not go through.
      </p>
      <div className="note-draft-recovery-actions">
        <button className="btn-primary" type="button" onClick={() => onRestore(draft)}>
          Restore them
        </button>
        <button className="btn-secondary" type="button" onClick={onDiscard}>
          Discard
        </button>
      </div>
      <small>Kept on this device for seven days, then removed.</small>
    </section>
  );
}
