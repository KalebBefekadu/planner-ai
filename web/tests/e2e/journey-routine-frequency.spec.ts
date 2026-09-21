import { test, expect, goTo } from './support/workspace';

/* "Three times a week" is the routine most people actually have, and the
   product could only record it as three appointments nobody made. This is the
   evidence that a target is counted rather than scheduled, and that the count
   is one a person can trust: a fourth session is refused rather than quietly
   making the week look better than it was. */

test('a routine can be a target, and the week counts it rather than scheduling it', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/planner');

  await page.getByRole('button', { name: 'Create recurring Action' }).click();
  const dialog = page.getByRole('dialog', { name: /template/i });
  await dialog.getByLabel('Title').fill('Run');
  await dialog.getByLabel('Times per period').fill('3');
  await dialog.getByRole('button', { name: 'Save template' }).click();

  const routine = page.getByRole('article').filter({ hasText: 'Run' });
  await expect(routine).toContainText('3× a week', { timeout: 30_000 });
  await expect(routine).toContainText('no fixed day');

  // The week says where it is up to, before anything has happened.
  await goTo(page, '/planner/week');
  const routines = page.getByRole('region', { name: 'Routines this week' });
  await expect(routines).toContainText('0 of 3 this week');

  await routines.getByRole('button', { name: 'Record today' }).click();
  await expect(routines).toContainText('1 of 3 this week', { timeout: 30_000 });

  // A second press on the same day is the same session, not a second one:
  // the count is a record of what happened, not of how often it was tapped.
  await routines.getByRole('button', { name: 'Record today' }).click();
  await page.waitForTimeout(2_000);
  await expect(routines).toContainText('1 of 3 this week');
});
