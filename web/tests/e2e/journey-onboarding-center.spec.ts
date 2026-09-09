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

// Closing the browser mid-migration used to end the report: a committed job is
// not returned by the default query and its id existed nowhere outside the
// page that was just discarded. A Notion export is the largest thing this
// product ingests, so a report that cannot be reopened forces the whole
// migration into one sitting.
test('a finished import report can be reopened from history after a reload', async ({
  workspace,
}) => {
  const { page } = workspace;

  await goTo(page, '/onboarding');
  await page.getByRole('button', { name: 'Import Notes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import Notes' });
  await dialog.getByLabel('Source').selectOption('generic');
  await dialog
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'Reopenable.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Reopenable\n\nA migration outlives one browser session.'),
    });
  await dialog.getByRole('button', { name: 'Import 1' }).click();
  await expect(dialog.getByText('1 Notes imported', { exact: true })).toBeVisible();

  await goTo(page, '/onboarding');
  await page.getByRole('button', { name: 'Import Notes' }).click();
  const reopened = page.getByRole('dialog', { name: 'Import Notes' });
  const history = reopened.getByRole('region', { name: 'Past imports' });
  await expect(history).toBeVisible();
  await history.getByRole('button', { name: /Reopenable\.md/ }).click();

  await expect(reopened.getByLabel('Import preview')).toContainText('Reopenable');
  await expect(reopened.getByLabel('Import preview')).toContainText('Imported');
  await expect(reopened.getByText('1 Notes imported', { exact: true })).toBeVisible();
});

// A CSV row is the one supported source whose meaning changes on the way in.
// The owner has to be able to see that before agreeing to the commit, not
// discover it afterwards by finding a Notion database reduced to loose pages.
test('a CSV import states what the conversion left behind before anything is created', async ({
  workspace,
}) => {
  const { page } = workspace;

  await goTo(page, '/onboarding');
  await page.getByRole('button', { name: 'Import Notes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import Notes' });
  await dialog.getByLabel('Source').selectOption('generic');
  await dialog
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'Roadmap.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Name,Status\nShip the migration,Doing\n'),
    });

  await expect(dialog.getByLabel('Import preview')).toContainText(
    'Column types, formulas, relations, filters and views are not imported.'
  );
  // Still a preview: the notice has to arrive before the commit, not with it.
  await expect(dialog.getByText('Preview only. Your Notes are unchanged.')).toBeVisible();
});
