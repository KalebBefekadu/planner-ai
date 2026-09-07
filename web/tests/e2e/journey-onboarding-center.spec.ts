import { test, expect, goTo } from './support/workspace';

test('a completed workspace can return to the onboarding center and start a guarded import', async ({
  workspace,
}) => {
  const { page } = workspace;

  await goTo(page, '/onboarding');
  await expect(
    page.getByRole('heading', { name: 'Make Planner AI your daily workspace' })
  ).toBeVisible();
  await expect(page.getByText('One personal folder, 5–10 pages')).toBeVisible();

  await page.getByRole('button', { name: 'Import Notes' }).click();
  await expect(page.getByRole('dialog', { name: 'Import Notes' })).toBeVisible();
});
