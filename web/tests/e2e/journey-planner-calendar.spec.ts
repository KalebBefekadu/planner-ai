import { test, expect, goTo, onboardingSeed } from './support/workspace';

test('the Planner calendar schedules and completes an Action without leaving the planning context', async ({
  workspace,
}, testInfo) => {
  const { page } = workspace;
  await goTo(page, '/planner/calendar');

  await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  const plannerNavigation = page.getByLabel('Planner navigation');
  if (testInfo.project.name === 'mobile-chromium') {
    await expect(plannerNavigation).toBeHidden();
  } else {
    await expect(plannerNavigation).toBeVisible();
  }
  await expect(page.getByLabel('Workspace navigation')).toHaveCount(0);

  await page.getByRole('button', { name: `Schedule ${onboardingSeed.action}` }).click();
  const dialog = page.getByRole('dialog', { name: onboardingSeed.action });
  await dialog.getByLabel('Scheduled date').fill('2030-01-02');
  await dialog.getByRole('button', { name: 'Save date' }).click();

  await expect(page.getByRole('status')).toContainText('scheduled for Jan 2');
  await expect(page.getByRole('heading', { name: /January 2/ })).toBeVisible();
  const selectedDay = page.getByRole('region', { name: /January 2/ });
  await expect(selectedDay).toContainText(onboardingSeed.action);

  await page.getByRole('button', { name: `Complete ${onboardingSeed.action}` }).click();
  await expect(page.getByRole('status')).toContainText('completed');
  await expect(selectedDay).not.toContainText(onboardingSeed.action);
});
