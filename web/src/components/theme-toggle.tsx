'use client';

import { applyTheme, nextTheme, THEME_LABEL, useThemePreference } from '@/lib/shell/theme';

/* Presentation only. The three-state contract and the <html> stamp live in
   lib/shell/theme.ts, which the Preview rail control shares. */
export function ThemeToggle() {
  const theme = useThemePreference();
  const next = nextTheme(theme);

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={() => applyTheme(next)}
      aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next]}`}
      title={`Theme: ${THEME_LABEL[theme]}`}
    >
      <span aria-hidden="true">{THEME_LABEL[theme]}</span>
    </button>
  );
}
