'use client';

import { useSyncExternalStore } from 'react';

/* One theme store for the whole application, Preview included.
 *
 * Three states, not two. "System" is the default and follows
 * prefers-color-scheme; choosing light or dark stamps data-theme on <html> and
 * wins over the OS in both directions. The stamp lands on the document element
 * so it matches the pre-paint script in app/layout.tsx, and so a nested
 * surface can never end up half-themed against its own ancestor.
 *
 * Read through to storage rather than mirroring it into state, so the DOM and
 * every control reading it cannot disagree. The server snapshot is always
 * 'system', which keeps the server and first client render agreeing. */

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_KEY = 'planner-theme';
export const THEME_EVENT = 'planner-theme-change';
export const THEME_ORDER: ThemePreference[] = ['system', 'light', 'dark'];

export const THEME_LABEL: Record<ThemePreference, string> = {
  system: 'Match system',
  light: 'Light',
  dark: 'Dark',
};

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

function snapshot(): ThemePreference {
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export function nextTheme(current: ThemePreference): ThemePreference {
  return THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
}

export function applyTheme(next: ThemePreference) {
  if (next === 'system') {
    window.localStorage.removeItem(THEME_KEY);
    delete document.documentElement.dataset.theme;
  } else {
    window.localStorage.setItem(THEME_KEY, next);
    document.documentElement.dataset.theme = next;
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, snapshot, () => 'system' as const);
}
