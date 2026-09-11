import { test, expect } from '@playwright/test';

/* The reference frame had no browser coverage of its own geometry. Both panel
 * widths are data -- a person drags them -- and the rest of the application
 * writes measurements like that through the CSSOM rather than a style
 * attribute, because a nonce does not extend to style attributes and a
 * stricter policy would drop them (components/measured-fill.tsx records what
 * that looked like). Preview was the last place setting frame geometry the
 * other way, so these tests assert the widths actually reach the grid and that
 * the resizer is a real control rather than a decorative grip. */
test.describe('the preview frame applies the widths it is given', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/preview');
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  });

  test('the sidebar resizer moves the sidebar and the width applies', async ({ page }) => {
    const resizer = page.getByRole('separator', { name: 'Resize sidebar' });
    await expect(resizer).toBeVisible();

    const widthOf = () =>
      page.evaluate(() => {
        const frame = document.querySelector<HTMLElement>('[class*="previewRoot"]');
        if (!frame) return null;
        return {
          variable: frame.style.getPropertyValue('--v2-sidebar-w'),
          column: getComputedStyle(frame).gridTemplateColumns.split(' ')[1],
        };
      });

    const before = await widthOf();
    expect(before?.variable, 'the frame never received a sidebar width').not.toBe('');

    await resizer.focus();
    for (let press = 0; press < 6; press += 1) await page.keyboard.press('ArrowRight');

    await expect.poll(async () => (await widthOf())?.column).not.toBe(before?.column);
  });

  test('every style the frame renders is applied, not discarded', async ({ page }) => {
    const refusals: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().includes('style-src')) {
        refusals.push(message.text());
      }
    });
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();

    // A style attribute whose declaration block is empty is one the browser
    // refused, so the value never reached the page.
    const discarded = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[style]'))
        .filter((element) => element.style.length === 0 && element.getAttribute('style'))
        .map((element) => `${element.tagName.toLowerCase()}: ${element.getAttribute('style')}`)
    );

    expect(discarded, '/preview rendered a style the policy refuses').toEqual([]);
    expect(refusals, '/preview was refused a style by the policy').toEqual([]);
  });
});
