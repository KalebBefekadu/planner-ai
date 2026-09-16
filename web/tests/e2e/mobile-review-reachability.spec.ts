import { test, expect, waitForHydration } from './support/workspace';

// UI (#193): the monthly and quarterly reviews could be filled in on a phone
// and then not submitted, because the fixed bottom navigation sat on top of
// the control that submits them.
//
// The assertion is deliberately a real tap rather than a geometry check. A
// button can be visible, scrolled into view and still unclickable, which is
// exactly what happened here: Playwright reported the Workspace link in the
// bottom navigation receiving the pointer event instead. Forcing the click
// would make this file pass while the product stayed broken, so the click is
// left to behave the way a person's thumb does.

test.describe('a review can be completed on a phone', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  for (const period of ['month', 'quarter'] as const) {
    test(`the ${period}ly review submits from a mobile viewport`, async ({ workspace }) => {
      const { page } = workspace;
      // goTo asserts an exact path, so the query form is navigated directly.
      await page.goto(`/review?period=${period}`);
      await waitForHydration(page);

      const complete = page.getByRole('button', { name: `Complete ${period} review` });
      await expect(complete).toBeVisible();

      await page
        .getByLabel('What changed, what mattered, and what will you adjust next?')
        .fill(`What the ${period} was actually for.`);

      // Scrolling is what a person does before reaching for the button, and it
      // is also what used to leave the button underneath the navigation bar.
      await complete.scrollIntoViewIfNeeded();

      // The bar is fixed, so it must not be the thing under the thumb at the
      // point the button occupies.
      const box = await complete.boundingBox();
      expect(box).not.toBeNull();
      const owner = await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return el
            ? el.closest('.experience-mobile-bottom-nav')
              ? 'bottom-nav'
              : 'page'
            : 'none';
        },
        { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
      );
      expect(owner, 'the submit control is not underneath the bottom navigation').toBe('page');

      await complete.click({ timeout: 10_000 });

      // Completing replaces the form with the recorded reflection, so the
      // written words coming back is the evidence that the tap reached the
      // server rather than being swallowed by the bar.
      const recorded = page.locator('.period-reflection-complete');
      await expect(recorded).toContainText(`What the ${period} was actually for.`);
      await expect(recorded.getByText(/^Completed /)).toBeVisible();
    });
  }
});
