import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const pages = [
  ['/login', 'login'],
  ['/signup', 'signup'],
  ['/forgot-password', 'password recovery'],
  ['/offline-capture.html', 'offline Capture'],
  ['/preview', 'frontend preview'],
] as const;

for (const [path, name] of pages) {
  test(`${name} has no automated WCAG A/AA violations`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
}
