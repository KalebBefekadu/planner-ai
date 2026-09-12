'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ListTodo, NotebookPen } from 'lucide-react';
import {
  fileCaptureAsActionAction,
  fileCaptureAsNoteAction,
  type CaptureFilingResult,
} from '@/app/inbox/actions';

const FILED_MESSAGE = {
  note: 'Filed as a Note',
  action: 'Filed as an Action',
} as const;

/**
 * The two direct routes out of the Capture inbox.
 *
 * A Capture is only useful once it becomes something a person can act on or
 * come back to, and until now the only bridge was the model. These controls
 * are the manual bridge: no analysis, no proposal to approve, and no
 * dependence on an AI provider being reachable or switched on.
 */
export function CaptureFilingControls({
  captureId,
  captureState,
}: {
  captureId: string;
  captureState: 'new' | 'proposed' | 'reviewed' | 'archived';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filed, setFiled] = useState<'note' | 'action' | null>(null);
  // A Capture the server already considers reviewed is filed whether or not
  // this page was the one that filed it. Reading the stored state rather than
  // only this component's memory is what makes the inbox honest after a
  // reload, which is the point of recording the state at all.
  const isFiled = captureState === 'reviewed' || filed !== null;
  const [error, setError] = useState<string | null>(null);

  function file(target: 'note' | 'action', run: () => Promise<CaptureFilingResult>) {
    setError(null);
    startTransition(async () => {
      const result = await run();
      if (!result.ok) {
        // The Capture is untouched by a failed filing, so the person keeps
        // both the words and the option to try again.
        setError(result.error);
        return;
      }
      setFiled(target);
      router.refresh();
    });
  }

  return (
    <div className="capture-filing">
      <div className="capture-filing-actions">
        <button
          className="btn-secondary capture-filing-button"
          type="button"
          disabled={pending}
          onClick={() => file('note', () => fileCaptureAsNoteAction(captureId))}
        >
          <NotebookPen size={15} aria-hidden="true" />
          File as Note
        </button>
        <button
          className="btn-secondary capture-filing-button"
          type="button"
          disabled={pending}
          onClick={() => file('action', () => fileCaptureAsActionAction(captureId))}
        >
          <ListTodo size={15} aria-hidden="true" />
          File as Action
        </button>
      </div>
      {isFiled && !pending && !filed ? (
        <p className="capture-filing-status capture-filing-filed" role="status">
          <CheckCircle2 size={14} aria-hidden="true" />
          Filed
        </p>
      ) : null}
      {pending ? (
        <p className="capture-filing-status" role="status">
          Filing...
        </p>
      ) : filed ? (
        <p className="capture-filing-status" role="status">
          <CheckCircle2 size={14} aria-hidden="true" />
          {FILED_MESSAGE[filed]}
        </p>
      ) : null}
      {error ? (
        <p className="capture-filing-status capture-filing-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
