'use client';

import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { CoachingCue as CoachingCueValue } from '@/lib/coaching';

export function CoachingCue({ cue }: { cue: CoachingCueValue }) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;

  return (
    <aside className="coaching-cue" aria-live="polite">
      <Sparkles size={17} aria-hidden="true" />
      <div>
        <strong>{cue.label}</strong>
        <p>{cue.message}</p>
      </div>
      <button
        className="icon-button"
        type="button"
        title="Dismiss coaching prompt"
        aria-label="Dismiss coaching prompt"
        onClick={() => setVisible(false)}
      >
        <X size={15} />
      </button>
    </aside>
  );
}
