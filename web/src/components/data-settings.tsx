'use client';

import { useState, useTransition } from 'react';
import { Download, FileJson, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  cancelAccountDeletion,
  scheduleAccountDeletion,
  type AccountDeletionRequest,
} from '@/app/settings/data/actions';

export function DataSettings({
  assuranceLevel,
  deletionRequest,
}: {
  assuranceLevel: 'aal1' | 'aal2';
  deletionRequest: AccountDeletionRequest | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [deletionPending, startDeletionTransition] = useTransition();
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function downloadExport() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/export', { cache: 'no-store' });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? 'Export failed.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'planner-ai-export.json';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Export failed.');
    } finally {
      setPending(false);
    }
  }

  function scheduleDeletion() {
    setError(null);
    startDeletionTransition(async () => {
      try {
        await scheduleAccountDeletion(confirmation);
        setConfirmation('');
        router.refresh();
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'Account deletion could not be scheduled.'
        );
      }
    });
  }

  function cancelDeletion() {
    if (!deletionRequest) return;
    setError(null);
    startDeletionTransition(async () => {
      try {
        await cancelAccountDeletion(deletionRequest.id);
        router.refresh();
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'Account deletion could not be canceled.'
        );
      }
    });
  }

  return (
    <div className="data-settings-layout">
      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="settings-section export-section">
        <div>
          <FileJson size={19} aria-hidden="true" />
          <div>
            <h2>Full Workspace export</h2>
            <p>
              Versioned JSON including Markdown Notes, chat, Memory, Activity, and grant metadata.
            </p>
          </div>
        </div>
        <button
          className="btn-primary button-with-icon"
          type="button"
          disabled={pending || assuranceLevel !== 'aal2'}
          onClick={() => void downloadExport()}
        >
          <Download size={15} />
          {pending ? 'Preparing...' : 'Download export'}
        </button>
      </section>
      {assuranceLevel !== 'aal2' ? (
        <p className="status-message status-message-error" role="alert">
          Verify this session on the Security tab before exporting private data.
        </p>
      ) : null}

      <section className="settings-section account-deletion-section">
        <div className="account-deletion-heading">
          <ShieldAlert size={19} aria-hidden="true" />
          <div>
            <h2>Delete account and Workspace</h2>
            <p>
              Deletion is permanent after a seven-day cancellation period. Create an export first.
            </p>
          </div>
        </div>

        {deletionRequest ? (
          <div className="deletion-pending-row">
            <div>
              <strong>
                {deletionRequest.status === 'processing'
                  ? 'Deletion is processing'
                  : 'Deletion is scheduled'}
              </strong>
              <span>
                Permanent deletion is due{' '}
                {new Intl.DateTimeFormat('en-US', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(deletionRequest.scheduledFor))}
                .
              </span>
            </div>
            {deletionRequest.status === 'scheduled' ? (
              <button
                className="btn-secondary button-with-icon"
                type="button"
                disabled={deletionPending}
                onClick={cancelDeletion}
              >
                <RotateCcw size={15} />
                {deletionPending ? 'Canceling...' : 'Cancel deletion'}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="account-deletion-form">
            <label>
              Type <strong>DELETE MY ACCOUNT</strong> to confirm
              <input
                className="input-field"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button
              className="btn-danger button-with-icon"
              type="button"
              disabled={
                deletionPending || assuranceLevel !== 'aal2' || confirmation !== 'DELETE MY ACCOUNT'
              }
              onClick={scheduleDeletion}
            >
              <Trash2 size={15} />
              {deletionPending ? 'Scheduling...' : 'Schedule deletion'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
