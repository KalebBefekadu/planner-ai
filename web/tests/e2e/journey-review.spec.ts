import { test, expect, goTo, onboardingSeed } from './support/workspace';

// PL-09: finishing a week. The claim this screen makes is still "no silent
// rollover", but what carries it changed: work stays open freely and the screen
// shows how long each item has sat, so the thing worth testing is that leaving
// work alone is cheap, that saying something once is enough, and that the week
// reports what it finished.

async function addAction(page: import('@playwright/test').Page, title: string) {
  const composer = page.getByRole('region', { name: 'New Action' });
  await composer.getByRole('textbox', { name: 'What needs doing' }).fill(title);
  await composer.getByRole('button', { name: 'Add Action' }).click();
  await expect(composer).toContainText(`"${title}" is saved`);
}

test('a week closes without answering for work that is simply still open', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/');
  await addAction(page, 'Carry into next week');
  await addAction(page, 'Stop doing this');

  await goTo(page, '/review');
  const complete = page.getByRole('button', { name: 'Complete weekly review' });

  // Nothing here has outlived a single completed Review, so nothing has to be
  // answered for. This is the weekly tax the screen used to charge on every
  // row: the answer was "yes, obviously, still doing that" nine times out of
  // ten, and it had to be given anyway.
  await expect(complete).toBeEnabled();
  await expect(page.locator('p.review-validation')).toHaveCount(0);
  await expect(page.getByText('Carry into next week')).toBeVisible();

  // Work that is new says so rather than claiming a week it has not lived
  // through, and nothing is marked as needing a decision.
  await expect(page.locator('.review-carry').first()).toHaveText('new');
  await expect(page.locator('.review-action-stalled')).toHaveCount(0);

  // Deciding is still possible, and dropping still records why -- that part of
  // the contract did not move.
  await page
    .getByRole('combobox', { name: 'Decision for Stop doing this' })
    .selectOption('dropped');
  await expect(complete).toBeDisabled();
  // Scoped to the form's own message: Next's route announcer is also an alert.
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

test('the week reports what it finished, not only what it did not', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/');
  await addAction(page, 'Ship the import report');

  // Completing work is what the week is for, and until now the one screen
  // built to look back at a week could not show any of it: both of its queries
  // filtered to open work, so completed_at was never read.
  await page.getByRole('button', { name: 'Complete Ship the import report' }).click();
  await expect(page.getByRole('button', { name: 'Complete Ship the import report' })).toHaveCount(
    0
  );

  await goTo(page, '/review');
  await expect(page.locator('.review-finished-list')).toContainText('Ship the import report');

  // Every level closes, and closing keeps the count: a collapsed section hides
  // lines, never numbers.
  const trigger = page.getByRole('button', { name: /^What you did Finished/ });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.review-finished-list')).toBeHidden();
  await expect(trigger).toContainText('1');
});

test('the week is grouped by the project the work is for', async ({ workspace }) => {
  const { page } = workspace;

  // The ritual being replaced is a folder per business. An initiative is the
  // folder: a Goal that is never reached, so it is never asked whether it was.
  await goTo(page, '/planner');
  await page.getByRole('button', { name: 'Add yearly goal' }).last().click();
  const composer = page.locator('section.goal-composer');
  await expect(composer).toBeVisible();
  await composer.locator('textarea').fill('Real estate agent business');
  await composer.locator('input[type=checkbox]').check();
  await composer.getByRole('button', { name: 'Save initiative' }).click();
  await expect(page.getByText('Real estate agent business is now an initiative')).toBeVisible();

  await goTo(page, '/');
  const today = page.getByRole('region', { name: 'New Action' });
  for (const title of ['Write the listing script', 'Value First follow up']) {
    await today.getByRole('textbox', { name: 'What needs doing' }).fill(title);
    await today
      .getByRole('combobox', { name: 'Goal' })
      .selectOption({ label: 'Real estate agent business' });
    await today.getByRole('button', { name: 'Add Action' }).click();
    await expect(today).toContainText(`"${title}" is saved`);
  }

  await goTo(page, '/review');
  const group = page.getByRole('button', { name: /^Initiative Real estate agent business/ });
  await expect(group).toBeVisible();
  await expect(group).toContainText('2');

  // The grouping is a level of disclosure like any other, and closing it keeps
  // the count on the row.
  await group.click();
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Write the listing script')).toBeHidden();
  await expect(group).toContainText('2 open');
});

test('what good looks like is on screen at the moment work is dropped', async ({ workspace }) => {
  const { page } = workspace;

  await goTo(page, '/planner');
  await page.getByRole('button', { name: 'Add yearly goal' }).last().click();
  const composer = page.locator('section.goal-composer');
  await expect(composer).toBeVisible();
  await composer.locator('textarea').fill('TEK Systems');
  await composer.locator('input[type=checkbox]').check();
  await composer.getByRole('button', { name: 'Save initiative' }).click();
  await expect(page.getByText('TEK Systems is now an initiative')).toBeVisible();

  // An initiative is never finished, so the editor does not offer a due date --
  // it asks what would make the quarter good instead.
  await page.getByRole('button', { name: 'Edit TEK Systems' }).click();
  const editor = page.getByRole('textbox', {
    name: 'What would make this quarter good here?',
  });
  await expect(page.getByRole('textbox', { name: 'Due date' })).toHaveCount(0);
  await editor.fill('A signed contract, or a clear no so the time goes elsewhere.');
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByText('Yearly goal saved.')).toBeVisible();

  await goTo(page, '/');
  const today = page.getByRole('region', { name: 'New Action' });
  await today.getByRole('textbox', { name: 'What needs doing' }).fill('Wait for a start date');
  await today.getByRole('combobox', { name: 'Goal' }).selectOption({ label: 'TEK Systems' });
  await today.getByRole('button', { name: 'Add Action' }).click();
  await expect(today).toContainText('"Wait for a start date" is saved');

  await goTo(page, '/review');
  // The criterion is visible on the initiative before any decision is made.
  await expect(page.locator('.review-goal-criterion')).toContainText('A signed contract');

  // And again next to the reason, because dropping is only defensible when the
  // standard it failed is visible while you decide rather than afterwards.
  await expect(page.locator('.review-drop-criterion')).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Decision for Wait for a start date' })
    .selectOption('dropped');
  await expect(page.locator('.review-drop-criterion')).toContainText(
    'A signed contract, or a clear no so the time goes elsewhere.'
  );
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

test('work planned monthly and committed to this week can be resolved here', async ({
  workspace,
}) => {
  const { page } = workspace;

  // The onboarding Action is planned at a monthly horizon and scheduled for
  // today. Today lets a person commit exactly this kind of work to their day,
  // and Weekly Review used to look only at week-horizon Actions -- so it could
  // not be decided here at all, and could not be reported as part of the week.
  await goTo(page, '/');
  await page.getByRole('button', { name: `Focus ${onboardingSeed.action}` }).click();
  await expect(page.getByRole('region', { name: 'Committed Actions' })).toContainText('1 / 5');

  await goTo(page, '/review');
  await expect(page.getByText('Nothing unresolved')).toHaveCount(0);
  const complete = page.getByRole('button', { name: 'Complete weekly review' });

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
