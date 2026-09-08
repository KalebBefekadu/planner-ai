import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/app/globals.css', 'utf8');
const layout = readFileSync('src/app/layout.tsx', 'utf8');
const themeToggle = readFileSync('src/components/theme-toggle.tsx', 'utf8');
const experienceShell = readFileSync('src/components/experience-shell.tsx', 'utf8');
const notesWorkspace = readFileSync('src/components/notes-workspace.tsx', 'utf8');

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

  it('keeps onboarding outside the authenticated application chrome', () => {
    expect(experienceShell).toContain("const standaloneFlow = pathname === '/onboarding'");
    expect(experienceShell).toContain("standaloneFlow ? ' experience-standalone' : ''");
    expect(css).toMatch(
      /\.experience-standalone > \.experience-mobile-bottom-nav\s*{[^}]*display:\s*none/
    );
  });

  it('lets Notes provide the single real workspace tree', () => {
    expect(experienceShell).toContain("const contentOwnsSidebar = pathname === '/notes'");
    expect(experienceShell).toContain('sidebarOpen && !contentOwnsSidebar');
    expect(css).toMatch(
      /\.experience-content-sidebar\s*{[^}]*grid-template-columns:\s*56px minmax\(0, 1fr\)/
    );
    expect(css).toMatch(
      /\.experience-content-sidebar\.experience-sidebar-collapsed \.notes-sidebar\s*{[^}]*display:\s*none/
    );
    expect(css).toMatch(
      /@media \(max-width: 760px\)[\s\S]*\.experience-content-sidebar\.experience-sidebar-collapsed \.notes-sidebar\s*{[^}]*display:\s*block/
    );
  });

  it('groups Note details without a hardcoded viewport-height calculation', () => {
    expect(notesWorkspace).toContain('aria-label="Note details"');
    expect(notesWorkspace).toContain('data-inspector-group="properties"');
    expect(notesWorkspace).toContain('data-inspector-group="links"');
    expect(notesWorkspace).toContain('data-inspector-group="history"');
    expect(css).not.toContain('max-height: calc(100vh - 224px)');
  });
});
