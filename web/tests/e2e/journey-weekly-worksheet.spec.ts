import { test, expect, goTo } from './support/workspace';

/* ENG-06 and ENG-07. The week was a query over whatever happened to be
   scheduled, so "planned tasks completed" had a numerator and no denominator.
   These journeys are the evidence for the three claims that replace it: the
   week is a selection someone made, committing freezes what it is a promise
   about, and closing writes a record that later edits cannot rewrite. */

test('a week is a worksheet with its own dates, not a filter on the plan', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/planner/week');

  await expect(page.getByRole('heading', { name: 'This week', level: 1 })).toBeVisible();
  // Real dates, and a way to the weeks either side of them.
  await expect(page.getByRole('navigation', { name: 'Choose a week' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Previous week' })).toBeVisible();

  await page.getByRole('link', { name: 'Next week' }).click();
  await expect(page).toHaveURL(/\/planner\/week\?week=\d{4}-\d{2}-\d{2}/);
});

test('committing freezes what the week promised, and later work is a late addition', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/planner/week');

  const entry = page.getByPlaceholder('What needs doing this week?');
  await entry.fill('Finish the household plan');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText('Finish the household plan')).toBeVisible({ timeout: 30_000 });

  await entry.fill('Compare the course options');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText('Compare the course options')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Commit this week' }).click();
  await expect(page.getByText('This week is committed.')).toBeVisible({ timeout: 30_000 });

  const tasks = page.getByRole('region', { name: "This week's tasks" });
  await expect(tasks.getByText('Committed')).toHaveCount(2);

  await entry.fill('Turned up on Wednesday');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(tasks.getByText('Added later')).toHaveCount(1, { timeout: 30_000 });
  // The promise does not grow to meet the week.
  await expect(tasks.getByText('Committed')).toHaveCount(2);
});

test('closing a week writes a record that later edits cannot rewrite', async ({ workspace }) => {
  // Two screens, a commitment, a completion, a decision and a close: this one
  // walks the whole loop and needs the room to do it.
  test.slow();
  const { page } = workspace;
  await goTo(page, '/planner/week');

  const entry = page.getByPlaceholder('What needs doing this week?');
  for (const title of ['Finish the plan', 'Compare the options']) {
    await entry.fill(title);
    await page.getByRole('button', { name: 'Add task' }).click();
    await expect(page.getByText(title)).toBeVisible({ timeout: 30_000 });
  }

  await page.getByRole('button', { name: 'Commit this week' }).click();
  await expect(page.getByText('This week is committed.')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('checkbox', { name: 'Complete Finish the plan' }).check();
  await expect(page.getByRole('checkbox', { name: 'Complete Finish the plan' })).toBeChecked({
    timeout: 30_000,
  });

  // The second question of a review: what needs a decision?
  const close = page.getByRole('region', { name: 'Close this week' });
  await expect(close.getByText('Compare the options')).toBeVisible();
  await close.getByRole('button', { name: 'Move it' }).first().click();
  await expect(close.getByText('Compare the options')).toHaveCount(0, { timeout: 30_000 });

  await page.getByRole('button', { name: 'Close this week' }).click();
  const record = page.getByRole('region', { name: 'Week record' });
  await expect(record).toContainText('50%', { timeout: 30_000 });
  await expect(record).toContainText('1 of 2');

  // Finishing the slipped work afterwards is real, and last week still reports
  // what last week did.
  // Today completes from a button, the worksheet from a tick box. Both go
  // through the same Operation; only the control differs.
  await goTo(page, '/planner/today');
  await page.getByRole('button', { name: 'Complete Compare the options' }).click();
  await expect(page.getByText('Compare the options')).toHaveCount(0, { timeout: 30_000 });

  await goTo(page, '/planner/week');
  await expect(page.getByRole('region', { name: 'Week record' })).toContainText('1 of 2');
});

test('a week with nothing planned reports no percentage rather than a zero', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/planner/week');

  await page.getByLabel('What matters this week').fill('A quiet week.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible({ timeout: 30_000 });

  const history = page.getByRole('region', { name: 'Previous weeks' });
  await expect(history).toBeVisible();
  // Open, so there is no record yet: an em dash, not a nought.
  await expect(history.getByRole('row').nth(1)).toContainText('—');
});
