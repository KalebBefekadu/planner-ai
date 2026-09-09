import { test, expect, goTo } from './support/workspace';

// PL-09: finishing a week. The claim this screen makes, in its own heading, is
// "No silent rollover" -- so the thing worth testing is that nothing crosses
// into next week without someone having said so, and that saying so once is
// enough.

async function addAction(page: import('@playwright/test').Page, title: string) {
  const composer = page.getByRole('region', { name: 'New Action' });
  await composer.getByRole('textbox', { name: 'What needs doing' }).fill(title);
  await composer.getByRole('button', { name: 'Add Action' }).click();
  await expect(composer).toContainText(`"${title}" is saved`);
}

test('a week closes only once every unfinished Action has been decided', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/');
  await addAction(page, 'Carry into next week');
  await addAction(page, 'Stop doing this');

  await goTo(page, '/review');
  const complete = page.getByRole('button', { name: 'Complete weekly review' });

  // Every row starts undecided, and the week cannot close while any of them
  // is. Defaulting rows to "leave overdue" made silent rollover the path of
  // least resistance through the one screen that exists to prevent it.
  await expect(complete).toBeDisabled();
  // Scoped to the form's own message: Next's route announcer is also an alert.
  await expect(page.locator('p.review-validation')).toContainText(
    'a decision before the week can close'
  );

  await page
    .getByRole('combobox', { name: 'Decision for Carry into next week' })
    .selectOption('next_week');
  await page
    .getByRole('combobox', { name: 'Decision for Stop doing this' })
    .selectOption('dropped');

  // Every row is decided now, so what still holds the week open is the reason:
  // dropping work records why, not only that it happened.
  await expect(complete).toBeDisabled();
  await expect(page.locator('p.review-validation')).toContainText('Add a reason');
  await page
    .getByRole('textbox', { name: 'Reason for Stop doing this' })
    .fill('Superseded by the invite work.');

  await expect(complete).toBeEnabled();
  await complete.click();

  await expect(page.getByRole('status')).toContainText('Review completed');
  // Closing the week has to lead somewhere; next week is a destination, not a
  // route the person is expected to remember.
  await expect(page.getByRole('link', { name: 'Plan next week' })).toBeVisible();
});

test('a completed review survives navigation and appears in the history', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/');
  await addAction(page, 'Finish the import notes');

  await goTo(page, '/review');
  await page
    .getByRole('combobox', { name: 'Decision for Finish the import notes' })
    .selectOption('next_week');
  await page
    .getByRole('textbox', { name: 'What should you remember from this week?' })
    .fill('Shipped the composer. Next week is about import.');
  await page.getByRole('button', { name: 'Complete weekly review' }).click();
  await expect(page.getByRole('status')).toContainText('Review completed');

  // The saved result is a record, not a page state.
  await goTo(page, '/planner');
  await goTo(page, '/review');
  const history = page.getByRole('complementary', { name: 'Past reviews' });
  await expect(history).toContainText('Shipped the composer. Next week is about import.');
  await expect(history).toContainText('1 actions');
});

test('submitting the same week twice does not record a second review', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/');
  await addAction(page, 'Something to carry');

  await goTo(page, '/review');
  await page
    .getByRole('combobox', { name: 'Decision for Something to carry' })
    .selectOption('left_overdue');
  await page.getByRole('button', { name: 'Complete weekly review' }).click();
  await expect(page.getByRole('status')).toContainText('Review completed');

  // A second submission of the same week is a retry, not a second review. One
  // completed review per week is a database invariant, so a fresh idempotency
  // key would have hit the unique index and surfaced as an unexplained
  // failure instead of replaying the result.
  await page.reload();
  await page
    .getByRole('combobox', { name: 'Decision for Something to carry' })
    .selectOption('left_overdue');
  await page.getByRole('button', { name: 'Complete weekly review' }).click();
  await expect(page.getByRole('status')).toContainText('Review completed');

  await page.reload();
  const history = page.getByRole('complementary', { name: 'Past reviews' });
  await expect(history.locator('article')).toHaveCount(1);
});

test('a review of a week with nothing unresolved can still be recorded', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/review');
  await expect(page.getByText('Nothing unresolved')).toBeVisible();

  // No decisions to make is not the same as nothing to say about the week.
  await page
    .getByRole('textbox', { name: 'What should you remember from this week?' })
    .fill('Quiet week, everything landed.');
  await page.getByRole('button', { name: 'Complete weekly review' }).click();
  await expect(page.getByRole('status')).toContainText('Review completed');
});
