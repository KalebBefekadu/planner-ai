'use client';

import { useSyncExternalStore } from 'react';

type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'planner-theme';
const EVENT = 'planner-theme-change';
const ORDER: ThemePreference[] = ['system', 'light', 'dark'];
const LABEL: Record<ThemePreference, string> = {
  system: 'Match system',
  light: 'Light',
  dark: 'Dark',
};

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

function snapshot(): ThemePreference {
  const stored = window.localStorage.getItem(KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/* Three states, not two. "System" is the default and follows
   prefers-color-scheme; choosing light or dark stamps data-theme on <html> and
   wins over the OS in both directions. Read through to storage rather than
   mirroring it into state, so the DOM and the control cannot disagree. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, snapshot, () => 'system' as const);
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];

  function choose() {
    if (next === 'system') {
      window.localStorage.removeItem(KEY);
      delete document.documentElement.dataset.theme;
    } else {
      window.localStorage.setItem(KEY, next);
      document.documentElement.dataset.theme = next;
    }
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={choose}
      aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[next]}`}
      title={`Theme: ${LABEL[theme]}`}
    >
      <span aria-hidden="true">{LABEL[theme]}</span>
    </button>
  );
}
