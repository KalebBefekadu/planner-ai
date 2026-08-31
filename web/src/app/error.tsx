'use client';

import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

/* The error boundary, built to the state design in /preview. The previous
   version was inline-styled and told the user "Something went wrong!" with an
   exclamation mark and no way to report it. What a person needs here is:
   their material is safe, one action that usually fixes it, and a reference
   they can quote if it does not. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    console.error('App Error:', error);
  }, [error]);

  const reference = error.digest ?? 'no reference';

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(`${reference} · ${window.location.pathname}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="state-page">
      <span className="state-icon" aria-hidden="true">
        <TriangleAlert size={22} />
      </span>
      <h1>This view failed to load</h1>
      <p>
        Your material is safe and nothing was lost. Reloading this view usually fixes it. If it
        keeps happening, the reference below helps us find the cause.
      </p>
      <div className="state-actions">
        <button className="btn-primary" type="button" onClick={() => reset()}>
          Reload this view
        </button>
        <button className="btn-secondary" type="button" onClick={copyDetails}>
          {copied ? 'Copied' : 'Copy error details'}
        </button>
      </div>
      <p className="state-reference" role="status">
        {copied ? 'Error details copied to your clipboard.' : null}
      </p>
      <code className="state-code">{reference}</code>
    </div>
  );
}
