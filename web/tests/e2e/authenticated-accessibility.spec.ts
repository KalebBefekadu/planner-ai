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

// Colour tokens are animated, so a scan taken while a transition is still
// running measures a blend of two themes rather than either one. That reports
// contrast failures against colours the page never actually rests on, and hides
// nothing real. Settle the page before measuring it.
async function settle(page: Page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // Injecting a stylesheet to switch transitions off is not available here:
    // the application sends a strict Content Security Policy and blocks it,
    // which is the behaviour a separate test already relies on. Wait the
    // running transitions out instead. Looping animations never finish, so
    // they are excluded rather than waited on.
    const settling = document
      .getAnimations()
      .filter((animation) => {
        const timing = animation.effect?.getComputedTiming();
        return timing !== undefined && timing.iterations !== Infinity;
      })
      .map((animation) => animation.finished.catch(() => undefined));
    await Promise.race([
      Promise.all(settling),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  });
}

async function scan(page: Page) {
  await settle(page);
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
