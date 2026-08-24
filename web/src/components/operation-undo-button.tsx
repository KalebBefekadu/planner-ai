'use client';

import { useState, useTransition } from 'react';
import { RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { undoOperation } from '@/app/activity/actions';

export function OperationUndoButton({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="activity-undo">
      <button
        className="activity-undo-button"
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              await undoOperation(receiptId);
              router.refresh();
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'Undo could not be completed.');
            }
          })
        }
      >
        <RotateCcw size={13} />
        {pending ? 'Undoing' : 'Undo'}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}
