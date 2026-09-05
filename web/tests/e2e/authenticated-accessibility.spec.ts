import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { scanTest as test, expect, goTo } from './support/workspace';

// The existing accessibility spec covers the five screens reachable without an
// account. Everything a person actually spends their day inside -- Today, the
// Inbox, the Planner, Notes, Review, Settings -- had never been scanned,
// because scanning them requires a signed-in Workspace. This closes that gap.
const surfaces = [
  ['/', 'Today'],
  ['/inbox', 'Capture inbox'],
  ['/planner', 'Planner'],
  ['/planner/calendar', 'Planner calendar'],
  ['/vision', 'Vision'],
  ['/notes', 'Notes'],
  ['/review', 'Weekly review'],
  ['/search', 'Search'],
  ['/activity', 'Activity'],
  ['/conversations', 'Conversations'],
  ['/notifications', 'Notifications'],
  ['/trash', 'Trash'],
  ['/settings/preferences', 'Preferences'],
  ['/settings/ai', 'AI settings'],
  ['/settings/safety', 'Safety settings'],
  ['/settings/security', 'Security settings'],
  ['/settings/data', 'Data settings'],
  ['/settings/memory', 'Memory settings'],
  ['/settings/mcp', 'MCP settings'],
] as const;

async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
}

for (const [path, name] of surfaces) {
  test(`${name} has no automated WCAG A/AA violations`, async ({ page }) => {
    await goTo(page, path);
    const results = await scan(page);
    expect(results.violations).toEqual([]);
  });
}

// Dark mode is not a repaint of the same page: it swaps every colour token, so
// contrast has to be proven separately. The theme is stored rather than
// inferred, which is why this sets the attribute the app itself sets.
test('the workspace stays accessible in dark mode', async ({ page }) => {
  for (const [path] of [['/'], ['/planner'], ['/notes'], ['/review']] as const) {
    await goTo(page, path);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    const results = await scan(page);
    expect(results.violations, `${path} in dark mode`).toEqual([]);
  }
});
