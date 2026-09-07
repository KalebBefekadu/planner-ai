import { scanTest as test, expect, goTo } from './support/workspace';

// Two release gates that are cheap to hold and easy to lose: a workspace that
// still works when the text is made large, and one that stops moving when a
// person has asked the operating system for less motion. Both are read-only
// checks, so they use the shared scan Workspace rather than creating data.

const surfaces = ['/', '/planner', '/notes', '/review', '/settings/preferences'] as const;

// WCAG 2.1 reflow: at 320 CSS pixels wide, which is a 1280 pixel window zoomed
// to 400 percent, content must reflow into one column rather than forcing a
// person to scroll sideways to read a line. Horizontal scrolling on the page
// itself is the failure this catches.
test.describe('the workspace reflows instead of scrolling sideways', () => {
  for (const path of surfaces) {
    test(`${path} reflows at 320 CSS pixels`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await goTo(page, path);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        // A single wide element is the usual cause, so name it rather than
        // leaving a bare width comparison to be puzzled over.
        widest: Array.from(document.querySelectorAll<HTMLElement>('body *'))
          .filter((element) => element.getBoundingClientRect().width > window.innerWidth + 1)
          .slice(0, 3)
          .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
      }));
      expect(
        overflow.scrollWidth,
        `${path} overflowed horizontally; widest: ${overflow.widest.join(', ')}`
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });
  }
});

test.describe('reduced motion', () => {
  test('the workspace stops animating when the system asks it to', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await goTo(page, '/notes');

    // Read the durations the page would actually use rather than watching for
    // movement, which would be timing-dependent and slow.
    const longest = await page.evaluate(() => {
      const durations = Array.from(document.querySelectorAll<HTMLElement>('body *')).flatMap(
        (element) => {
          const style = getComputedStyle(element);
          return [...style.transitionDuration.split(','), ...style.animationDuration.split(',')]
            .map((value) => parseFloat(value.trim()) * (value.includes('ms') ? 1 : 1000))
            .filter((value) => Number.isFinite(value));
        }
      );
      return durations.length ? Math.max(...durations) : 0;
    });

    // Durations are collapsed rather than removed, so that anything waiting on
    // a transition or animation to end is still told it ended.
    expect(longest).toBeLessThan(50);
  });

  test('an infinite busy animation does not keep running', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await goTo(page, '/');
    const repeating = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity)
          .length
    );
    expect(repeating).toBe(0);
  });
});
