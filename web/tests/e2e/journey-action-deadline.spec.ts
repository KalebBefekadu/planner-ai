import { test, expect, goTo, onboardingSeed } from './support/workspace';

/* A task had one date, and it had to mean two things: the day you sit down with
   something and the day it is owed. This is the evidence they are now separate
   facts on the same task -- that moving the work does not move the deadline,
   and that the deadline is not in the way until someone wants one. */

test('the day work is planned for and the day it is due move independently', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/');

  const row = page.getByRole('article').filter({ hasText: onboardingSeed.action });
  await expect(row).toBeVisible();
  // Nothing claims a deadline for work that was never given one.
  await expect(row).not.toContainText('Due');

  await page.getByRole('button', { name: `Edit ${onboardingSeed.action}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Action' });
  await expect(dialog).toBeVisible();

  // The deadline is not on the form until it is asked for.
  await expect(dialog.getByLabel('Deadline')).toBeHidden();
  await dialog.getByRole('button', { name: 'Add a deadline' }).click();

  await dialog.getByLabel('Scheduled date').fill('2026-09-22');
  await dialog.getByLabel('Deadline').fill('2026-09-25');
  await dialog.getByRole('button', { name: 'Save Action' }).click();

  await expect(row).toContainText('Due Sep 25', { timeout: 30_000 });

  // Moving the drafting day is not moving the deadline.
  await page.getByRole('button', { name: `Edit ${onboardingSeed.action}` }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Scheduled date').fill('2026-09-23');
  await dialog.getByRole('button', { name: 'Save Action' }).click();

  await expect(row).toContainText('Due Sep 25', { timeout: 30_000 });
  await expect(row).toContainText('Sep 23');
});
