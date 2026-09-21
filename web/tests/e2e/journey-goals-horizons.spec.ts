import { test, expect, goTo } from './support/workspace';

/* Goal titles appear twice on this page -- once as a row, and once as an
   option in the "sits under" picker -- so every assertion here names the rows.
   `getByText` alone matches the picker and reports a product that works as one
   that renders the same thing twice.

   The promise this journey is evidence for: a Goal that runs from one quarter
   into the next is one Goal, seen from both, and a Goal with no dates is
   honestly unscheduled rather than quietly filed into the period on screen. */

test('a goal that crosses a quarter boundary is one goal seen from both sides', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/goals?view=quarter&on=2026-11-15');

  await expect(page.getByRole('heading', { name: 'Q4 2026', level: 1 })).toBeVisible();

  await page.getByPlaceholder('What do you want to be true?').fill('Rebuild the back garden');
  await page.locator('summary', { hasText: 'Dates and where it sits' }).click();
  await page.getByLabel('Starts').fill('2026-10-01');
  await page.getByLabel('Target').fill('2027-03-31');
  await page.getByRole('button', { name: 'Add goal' }).click();

  const rows = page.getByRole('listitem');
  await expect(rows.filter({ hasText: 'Rebuild the back garden' })).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect(rows.getByText('Continues after')).toBeVisible();

  // The next quarter, and it is the same row rather than a second Goal.
  await page.getByRole('link', { name: 'Next period' }).click();
  await expect(page.getByRole('heading', { name: 'Q1 2027', level: 1 })).toBeVisible();
  await expect(rows.filter({ hasText: 'Rebuild the back garden' })).toHaveCount(1);
  await expect(rows.getByText('Started earlier')).toBeVisible();

  // And the year containing both shows it once, not twice.
  await goTo(page, '/goals?view=year&on=2026-11-15');
  await expect(rows.filter({ hasText: 'Rebuild the back garden' })).toHaveCount(1);
});

test('a goal with no dates is unscheduled, and stays that way until you say otherwise', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/goals?view=quarter&on=2026-11-15');

  await page.getByPlaceholder('What do you want to be true?').fill('Learn to sail');
  await page.locator('summary', { hasText: 'Dates and where it sits' }).click();
  // Deliberately no dates: the disclosure is open and both fields are empty.
  await page.getByRole('button', { name: 'Add goal' }).click();

  const unscheduled = page.getByRole('region', { name: 'Unscheduled goals' });
  const quarter = page.getByRole('region', { name: 'Goals in Q4 2026' });
  await expect(unscheduled.getByRole('listitem').filter({ hasText: 'Learn to sail' })).toHaveCount(
    1,
    { timeout: 30_000 }
  );

  // Not silently filed into the quarter that happened to be on screen.
  await expect(quarter.getByRole('listitem').filter({ hasText: 'Learn to sail' })).toHaveCount(0);

  await unscheduled.getByRole('button', { name: 'Give it dates' }).click();
  await unscheduled.getByLabel('Target').fill('2026-12-15');
  await unscheduled.getByRole('button', { name: 'Save dates' }).click();

  await expect(quarter.getByRole('listitem').filter({ hasText: 'Learn to sail' })).toHaveCount(1, {
    timeout: 30_000,
  });
});
