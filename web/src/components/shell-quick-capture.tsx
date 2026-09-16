'use client';

import { useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Inbox, Loader2 } from 'lucide-react';

import { saveTranscript } from '@/app/actions';
import { actionFailureMessage } from '@/lib/operations/failure-message';

/* Capturing a thought without leaving the page you are on.
 *
 * The shell previously offered a link to /inbox. A link is a fine way to
 * *review* captures and a poor way to *make* one: the thought arrives while
 * someone is in the middle of a Note or a review, and navigating away is
 * exactly the interruption the Capture idea exists to avoid. By the time the
 * page has changed, the sentence they meant to keep has often gone.
 *
 * So the composer lives in the shell, and saving does not navigate. The link
 * to the Inbox stays, because reviewing is a different act from capturing.
 *
 * The text is stored exactly as typed. capture.create.v1 holds raw immutable
 * text -- nothing here trims, reflows or reinterprets it, because the whole
 * value of a Capture is that it is what the person actually wrote. */

// Matches validateRawCapture on the server. Checked here too so that a thought
// too short to save says so before the round trip, rather than after it.
const MINIMUM = 3;

export function ShellQuickCapture({ label }: { label: string }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  /* The shell renders its sidebar twice on a phone -- once in the collapsed
     desktop position and once inside the drawer -- so a fixed id would appear
     twice in one document. Duplicate ids silently break `htmlFor`, leaving the
     second copy with no accessible name: the field a person actually taps
     would be the one a screen reader could not describe. */
  const fieldId = useId();

  const tooShort = text.trim().length < MINIMUM;

  async function capture() {
    if (tooShort || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      /* The exact text, not a trimmed copy. Leading and trailing whitespace is
         part of what was written; only the emptiness check trims. */
      await saveTranscript(text, 'typed');
      setText('');
      setSaved(true);
      /* The drawer is deliberately left open on a phone. Closing it on save
         unmounts this component, which takes the confirmation with it -- the
         person is returned to the page with no evidence their thought was
         kept, which is the one thing they need to see. It also makes a second
         capture a second trip through the menu.

         Focus returns to the field for the same reason: a captured thought is
         usually followed by another. */
      fieldRef.current?.focus();
    } catch (caught) {
      /* The words stay in the box on failure. They exist nowhere else, and a
         composer that clears itself on a failed save is a composer that eats
         the thing it was given. */
      setError(actionFailureMessage(caught, 'This capture could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="shell-quick-capture" aria-label={label}>
      <label className="shell-quick-capture-label" htmlFor={fieldId}>
        {label}
      </label>
      <textarea
        id={fieldId}
        ref={fieldRef}
        className="shell-quick-capture-field"
        value={text}
        rows={2}
        maxLength={60_000}
        placeholder="Whatever you do not want to lose."
        onChange={(event) => {
          setText(event.target.value);
          if (saved) setSaved(false);
        }}
        onKeyDown={(event) => {
          /* Enter inserts a newline, because a captured thought is often more
             than one line and losing the second half to a stray Return would
             defeat the point. The modifier saves, which is the convention
             every other composer in this application already uses. */
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void capture();
          }
        }}
      />
      <div className="shell-quick-capture-actions">
        <button
          className="btn-primary shell-quick-capture-save"
          type="button"
          onClick={() => void capture()}
          disabled={tooShort || saving}
        >
          {saving ? <Loader2 className="spin" size={14} aria-hidden="true" /> : null}
          {saving ? 'Saving…' : 'Capture'}
        </button>
        <Link className="shell-quick-capture-inbox" href="/inbox">
          <Inbox size={14} aria-hidden="true" />
          Inbox
        </Link>
      </div>
      {/* Announced rather than merely shown: the composer does not navigate, so
          without this a screen-reader user has no evidence the thought landed. */}
      <p className="shell-quick-capture-status" role="status">
        {saved ? 'Captured. It is waiting in your Inbox.' : ''}
      </p>
      {error ? (
        <p className="shell-quick-capture-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
