'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const savedTheme = localStorage.getItem('planner-theme');
    if (savedTheme === 'dark') {
      document.documentElement.dataset.theme = 'dark';
    }
  }, []);

  function toggleTheme() {
    const currentTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : theme;
    const nextTheme: Theme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    localStorage.setItem('planner-theme', nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      title="Change color theme"
    >
      <span aria-hidden="true">{theme === 'light' ? 'Dark' : 'Light'}</span>
    </button>
  );
}
