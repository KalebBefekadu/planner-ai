import { createClient } from '@supabase/supabase-js';
import { test, expect, goTo, localStackOrSkip, signIn } from './support/workspace';

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

// A person who starts setup, gets pulled away and closes the browser has still
// written real material into the wizard. Losing it is the difference between an
// interruption and starting over, so resumability is checked as its own
// journey rather than as a detail of the happy path.
test.describe('interrupted setup', () => {
  test('work typed into the wizard survives closing the browser', async ({ browser }, testInfo) => {
    const local = localStackOrSkip();
    test.skip(local === null, 'Restricted to the isolated local Supabase stack.');

    const admin = createClient(local!.url, local!.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `resume-${testInfo.project.name}-w${testInfo.workerIndex}-${Date.now()}@planner-ai.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'Planner-local-journey-test!9',
      email_confirm: true,
    });
    expect(error).toBeNull();
    const userId = data.user!.id;

    const vision = 'Build a studio practice that outlives any single project.';
    const goal = 'Take on four commissioned pieces this year.';

    try {
      // First visit: type a Vision and a Goal, then abandon setup mid-flow.
      const first = await browser.newContext();
      const page = await first.newPage();
      await signIn(page, email, testInfo.project.use.baseURL);
      await expect(page.getByRole('heading', { name: 'Set your direction' })).toBeVisible({
        timeout: 60_000,
      });
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('textbox', { name: 'Vision' }).fill(vision);
      await page.getByRole('textbox', { name: 'First yearly Goal' }).fill(goal);
      const storageState = await first.storageState();
      await first.close();

      // Second visit: same person, same device, a new browser session.
      const second = await browser.newContext({ storageState });
      const returning = await second.newPage();
      await returning.goto(`${testInfo.project.use.baseURL}/onboarding`);
      await expect(returning.getByRole('heading', { name: 'Set your direction' })).toBeVisible({
        timeout: 60_000,
      });
      // Resuming lands on the step the person left, not back at the beginning:
      // the Direction fields are on screen without navigating forward again.
      await expect(returning.getByRole('textbox', { name: 'Vision' })).toHaveValue(vision);
      await expect(returning.getByRole('textbox', { name: 'First yearly Goal' })).toHaveValue(goal);
      await expect(returning.getByText('We kept what you had already written.')).toBeVisible();

      // And the resumed setup still completes through the same Operation, so an
      // interruption costs nothing but the time away.
      await returning.getByRole('button', { name: 'Continue', exact: true }).click();
      await returning.getByRole('textbox', { name: 'First Action' }).fill('Draft the first brief.');
      await returning.getByRole('button', { name: 'Enter workspace', exact: true }).click();
      await expect(returning).toHaveURL(/\/$/, { timeout: 60_000 });

      // Once committed the scratch copy is gone, so returning to /onboarding
      // shows the finished workspace rather than resurrecting old text.
      await returning.goto(`${testInfo.project.use.baseURL}/onboarding`);
      await expect(
        returning.getByRole('heading', { name: 'Make Planner AI your daily workspace' })
      ).toBeVisible({ timeout: 60_000 });
      await second.close();
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });
});
