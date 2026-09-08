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
  const dialog = page.getByRole('dialog', { name: 'Import Notes' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Source').selectOption('generic');
  await dialog
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'Pilot import.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Pilot import\n\nThe first migration stays reviewable.'),
    });
  await dialog.getByRole('button', { name: 'Import 1' }).click();
  await expect(dialog.getByText('1 Notes imported', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Import preview')).toContainText('Imported');
});
