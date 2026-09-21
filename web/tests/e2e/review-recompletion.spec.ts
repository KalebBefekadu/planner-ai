import { test, expect, goTo, onboardingSeed } from './support/workspace';

for (const period of ['week', 'month', 'quarter'] as const) {
  test(`${period} review persists a new completion after undo`, async ({ workspace }) => {
    const { page } = workspace;
    async function openReview() {
      await goTo(page, '/review');
      if (period !== 'week') {
        await page
          .getByRole('link', { name: period === 'month' ? 'Month' : 'Quarter', exact: true })
          .click();
      }
    }
    async function submit(reflection: string) {
      if (period === 'week') {
        await page
          .getByRole('combobox', { name: `Decision for ${onboardingSeed.action}`, exact: true })
          .selectOption('left_overdue');
        await page.getByLabel('What should you remember from this week?').fill(reflection);
        await page.getByRole('button', { name: 'Complete weekly review' }).click();
        /* The confirmation is a toast that the refreshed record view replaces,
           so waiting for it is a race the test only sometimes wins. The record
           is what persists, and it is what this test is about. */
        await expect(page.getByRole('region', { name: 'Week complete' })).toContainText(reflection);
      } else {
        await page
          .getByLabel('What changed, what mattered, and what will you adjust next?')
          .fill(reflection);
        await page.getByRole('button', { name: `Complete ${period} review` }).click();
        await expect(page.locator('.period-reflection-complete')).toContainText(reflection);
      }
    }

    await openReview();
    await submit('First completion');
    await goTo(page, '/activity');
    const label = period === 'week' ? 'Review Complete-weekly' : 'Review Complete-period';
    const receipt = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: label, exact: true }) })
      .first();
    await receipt.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(receipt).toContainText('undone');
    await openReview();
    await submit('Corrected completion after undo');

    if (period === 'week') {
      // The record on screen is already asserted above. The receipt is the
      // second, independent piece of evidence that the correction was really
      // written -- and the undone one is still listed, so this asserts on the
      // newest rather than on any of them.
      await goTo(page, '/activity');
      const latest = page
        .locator('article')
        .filter({ has: page.getByRole('heading', { name: label, exact: true }) })
        .first();
      await expect(latest).not.toContainText('undone');
    } else {
      await page.reload();
      await expect(page.locator('.period-reflection-complete')).toContainText(
        'Corrected completion after undo'
      );
    }
  });
}
