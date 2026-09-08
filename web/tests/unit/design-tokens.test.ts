import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/app/globals.css', 'utf8');
const layout = readFileSync('src/app/layout.tsx', 'utf8');
const themeToggle = readFileSync('src/components/theme-toggle.tsx', 'utf8');

describe('brand and shell contracts', () => {
  it('defines and consumes one shared typography system', () => {
    expect(css).toContain('--font-ui:');
    expect(css).toContain('--font-display:');
    expect(css).toContain('--font-mono:');
    expect(css).toMatch(/body\s*{[^}]*font-family:\s*var\(--font-ui\)/);
    expect(css).toMatch(/\.experience-main h1\s*{[^}]*font-family:\s*var\(--font-display\)/);
  });

  it('uses the same persisted theme key before paint and in the control', () => {
    expect(layout).toContain("localStorage.getItem('planner-theme')");
    expect(themeToggle).toContain("const KEY = 'planner-theme'");
    expect(layout).not.toContain('planner-preview-theme');
    expect(themeToggle).not.toContain('planner-preview-theme');
  });

  it('does not gate authenticated users behind the retired shell rollout', () => {
    expect(layout).not.toContain('experienceV2EnabledForOwner');
    expect(layout).not.toContain('PLANNER_UI_V2');
    expect(layout).toContain('{user ? (');
  });
});
