import { test, expect, goTo, onboardingSeed } from './support/workspace';

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
  // The onboarding Action is planned monthly and scheduled for today. Before
  // this it was invisible here; the week could close without it ever having
  // been asked about.
  await page
    .getByRole('combobox', { name: `Decision for ${onboardingSeed.action}` })
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
    .getByRole('combobox', { name: `Decision for ${onboardingSeed.action}` })
    .selectOption('left_overdue');
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
  await expect(history).toContainText('2 actions');
});

test('a week that is already reviewed refuses a second review and says why', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/');
  await addAction(page, 'Something to carry');

  await goTo(page, '/review');
  await page
    .getByRole('combobox', { name: 'Decision for Something to carry' })
    .selectOption('left_overdue');
  await page
    .getByRole('combobox', { name: `Decision for ${onboardingSeed.action}` })
    .selectOption('left_overdue');
  await page.getByRole('button', { name: 'Complete weekly review' }).click();
  await expect(page.getByRole('status')).toContainText('Review completed');

  // Reloading and pressing the button again is not a retry of the first
  // submission -- it is a second, deliberate one. The week is already
  // reviewed, so it is refused, and the refusal says what to do instead of
  // reporting a success that saved nothing.
  await page.reload();
  await page
    .getByRole('combobox', { name: 'Decision for Something to carry' })
    .selectOption('left_overdue');
  await page
    .getByRole('combobox', { name: `Decision for ${onboardingSeed.action}` })
    .selectOption('left_overdue');
  await page.getByRole('button', { name: 'Complete weekly review' }).click();
  // Scoped to the review's own message: Next renders a permanently present
  // empty route announcer with role="alert" at the document root.
  await expect(page.locator('p.status-message-error')).toContainText('already been reviewed');

  await page.reload();
  const history = page.getByRole('complementary', { name: 'Past reviews' });
  await expect(history.locator('article')).toHaveCount(1);
});

test('a review of a week with nothing unresolved can still be recorded', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/');
  await page.getByRole('button', { name: `Complete ${onboardingSeed.action}` }).click();
  await expect(page.getByRole('button', { name: `Complete ${onboardingSeed.action}` })).toHaveCount(
    0
  );

  await goTo(page, '/review');
  await expect(page.getByText('Nothing unresolved')).toBeVisible();

  // No decisions to make is not the same as nothing to say about the week.
  await page
    .getByRole('textbox', { name: 'What should you remember from this week?' })
    .fill('Quiet week, everything landed.');
  await page.getByRole('button', { name: 'Complete weekly review' }).click();
  await expect(page.getByRole('status')).toContainText('Review completed');
});

test('work planned monthly and committed to this week must be resolved too', async ({
  workspace,
}) => {
  const { page } = workspace;

  // The onboarding Action is planned at a monthly horizon and scheduled for
  // today. Today lets a person commit exactly this kind of work to their day,
  // and Weekly Review used to look only at week-horizon Actions -- so leaving
  // it undone produced a week that closed reporting "Nothing unresolved"
  // while the Action rolled forward with no decision recorded against it.
  await goTo(page, '/');
  await page.getByRole('button', { name: `Focus ${onboardingSeed.action}` }).click();
  await expect(page.getByRole('region', { name: 'Committed Actions' })).toContainText('1 / 5');

  await goTo(page, '/review');
  await expect(page.getByText('Nothing unresolved')).toHaveCount(0);
  const complete = page.getByRole('button', { name: 'Complete weekly review' });
  await expect(complete).toBeDisabled();

  await page
    .getByRole('combobox', { name: `Decision for ${onboardingSeed.action}` })
    .selectOption('next_week');
  await complete.click();
  await expect(page.getByRole('status')).toContainText('Review completed');

  // Moving monthly work to next week moves the date, not the plan: it is
  // still monthly work, and rewriting its horizon would silently reclassify
  // it. So it stays in the Month horizon and leaves this week.
  await goTo(page, '/planner');
  const horizons = page.getByRole('group', { name: 'Filter plan by horizon' });
  await expect(horizons.getByRole('button', { name: /^Month/ })).toContainText('1');
  await expect(horizons.getByRole('button', { name: /^Week/ })).toContainText('0');
});

test('a week completed, undone and completed again is really saved the second time', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/');
  await addAction(page, 'Work to resolve twice');

  await goTo(page, '/review');
  await page
    .getByRole('combobox', { name: 'Decision for Work to resolve twice' })
    .selectOption('left_overdue');
  await page
    .getByRole('combobox', { name: `Decision for ${onboardingSeed.action}` })
    .selectOption('left_overdue');
  await page
    .getByRole('textbox', { name: 'What should you remember from this week?' })
    .fill('First attempt.');
  await page.getByRole('button', { name: 'Complete weekly review' }).click();
  await expect(page.getByRole('status')).toContainText('Review completed');

  // Undo leaves the original receipt in place, marked reversed, because
  // history is not rewritten. A completion key derived only from the period
  // therefore found that receipt and replayed a success for a review that no
  // longer existed -- the week reported complete and saved nothing.
  await goTo(page, '/activity');
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect(page.getByRole('button', { name: 'Undoing' })).toHaveCount(0);

  await goTo(page, '/review');
  await page
    .getByRole('combobox', { name: 'Decision for Work to resolve twice' })
    .selectOption('next_week');
  await page
    .getByRole('combobox', { name: `Decision for ${onboardingSeed.action}` })
    .selectOption('left_overdue');
  await page
    .getByRole('textbox', { name: 'What should you remember from this week?' })
    .fill('Second attempt, with a different decision.');
  await page.getByRole('button', { name: 'Complete weekly review' }).click();
  await expect(page.getByRole('status')).toContainText('Review completed');

  // The second completion is a real review with the second reflection, not the
  // first one played back.
  await page.reload();
  const history = page.getByRole('complementary', { name: 'Past reviews' });
  await expect(history).toContainText('Second attempt, with a different decision.');
  await expect(history).not.toContainText('First attempt.');
  await expect(history.locator('article')).toHaveCount(1);
});
