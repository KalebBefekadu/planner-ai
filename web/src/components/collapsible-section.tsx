'use client';

import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * One level of disclosure.
 *
 * Every level of the Weekly Review closes: the week's completions, each goal
 * inside them, the unfinished list, the reflection. The rule that makes closing
 * safe is that the summary row keeps the counts -- collapsing hides lines, never
 * numbers -- so a fully collapsed page is still an honest report of the week.
 */
export function CollapsibleSection({
  id,
  title,
  eyebrow,
  count,
  shut,
  open,
  onToggle,
  tone,
  children,
}: {
  id: string;
  title: string;
  eyebrow?: string;
  /** Shown beside the title at all times. */
  count?: number;
  /** Shown only while closed: what the reader would otherwise have to open to see. */
  shut?: ReactNode;
  open: boolean;
  onToggle: () => void;
  tone?: 'finished' | 'stalled';
  children: ReactNode;
}) {
  const bodyId = `${id}-body`;
  return (
    <section
      className={`collapsible${tone ? ` collapsible-${tone}` : ''}${open ? '' : ' collapsible-shut'}`}
    >
      <h3 className="collapsible-heading">
        <button
          type="button"
          className="collapsible-trigger"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <ChevronRight className="collapsible-chevron" size={14} aria-hidden="true" />
          <span className="collapsible-title">
            {eyebrow ? <span className="collapsible-eyebrow">{eyebrow}</span> : null}
            {title}
          </span>
          {typeof count === 'number' ? <span className="collapsible-count">{count}</span> : null}
          {!open && shut ? <span className="collapsible-shut-summary">{shut}</span> : null}
        </button>
      </h3>
      <div id={bodyId} className="collapsible-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
