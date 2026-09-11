import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/app/globals.css', 'utf8');
const layout = readFileSync('src/app/layout.tsx', 'utf8');
const themeToggle = readFileSync('src/components/theme-toggle.tsx', 'utf8');
const themeStore = readFileSync('src/lib/shell/theme.ts', 'utf8');
const previewCss = readFileSync('src/app/preview/preview.module.css', 'utf8');
const previewPage = readFileSync('src/app/preview/page.tsx', 'utf8');
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

  it('uses the same persisted theme key before paint and in every control', () => {
    expect(layout).toContain("localStorage.getItem('planner-theme')");
    expect(themeStore).toContain("export const THEME_KEY = 'planner-theme'");
    expect(layout).not.toContain('planner-preview-theme');
    expect(themeStore).not.toContain('planner-preview-theme');
  });

  it('gives Preview and the authenticated shell one theme store', () => {
    // Two stores meant an explicit choice stamped on .previewRoot while <html>
    // stayed light, which rendered the page half-themed.
    for (const source of [themeToggle, previewPage]) {
      expect(source).toContain("from '@/lib/shell/theme'");
      expect(source).not.toContain('localStorage');
    }
    expect(themeStore).toContain('document.documentElement.dataset.theme');
    expect(previewPage).not.toContain('data-theme={theme');
  });

  it('resolves every --v2-* name to the one global scale', () => {
    const defined = [...previewCss.matchAll(/^\s*(--v2-[a-z0-9-]+)\s*:\s*([^;]+);/gm)];
    expect(defined.length).toBeGreaterThan(50);
    for (const [, name, value] of defined) {
      // The two panel widths are set at runtime and legitimately carry a
      // literal fallback; every other name must be an alias, not a value.
      if (name === '--v2-sidebar-w' || name === '--v2-context-w') continue;
      expect(value.trim(), `${name} must alias a global token`).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
    const used = new Set([...previewCss.matchAll(/var\(\s*(--v2-[a-z0-9-]+)/g)].map((m) => m[1]));
    const names = new Set(defined.map((m) => m[1]));
    for (const name of used) {
      if (name === '--v2-sidebar-w' || name === '--v2-context-w') continue;
      expect(names.has(name), `${name} is used but never aliased`).toBe(true);
    }
  });

  it('keeps Preview from redefining the palette or a second dark theme', () => {
    expect(previewCss).not.toMatch(/\[data-theme='dark'\]/);
    expect(previewCss).not.toContain('prefers-color-scheme');
  });

  it('defines every dark token the light scale defines, in the same order', () => {
    const names = (block: string) =>
      [...block.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)]
        .map((m) => m[1])
        // The alias tail and the scale are theme-independent by design.
        .filter(
          (n) => !/^--(fs|r|t|lh|font)-|^--(ease|text|text-muted|line-strong|accent|teal)$/.test(n)
        );
    const at = (start: string) => {
      const i = css.indexOf(start);
      expect(i, `${start} block is missing`).toBeGreaterThan(-1);
      return css.slice(i, css.indexOf('\n}', i));
    };
    const light = names(at(':root {'));
    const explicitDark = names(at("[data-theme='dark'] {"));
    const systemDark = names(at(":root:not([data-theme='light']) {"));
    expect(light.length).toBeGreaterThan(40);
    expect(explicitDark).toEqual(light);
    expect(systemDark).toEqual(light);
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
