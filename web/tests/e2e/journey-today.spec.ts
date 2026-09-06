import { test, expect, goTo, onboardingSeed } from './support/workspace';

// Journey 4 of the delivery rule: deciding what today is actually for. The
// product's opinion here is that a day holds a small number of commitments,
// and that the cap limits what you highlight without limiting what you create.

const committedRegion = 'Committed Actions';
const openRegion = 'Open Actions';

test('an Action can be committed to today and shows up in the focus list', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/');

  const committed = page.getByRole('region', { name: committedRegion });
  await expect(committed).toContainText('0 / 5');
  await expect(committed).toContainText('No Actions are committed yet.');

  await page.getByRole('button', { name: `Focus ${onboardingSeed.action}` }).click();

  await expect(committed).toContainText('1 / 5');
  await expect(committed).toContainText(onboardingSeed.action);
  await expect(page.getByRole('region', { name: 'Today summary' })).toContainText('1');
});

test('committing survives a reload, so the day is a decision and not a view state', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/');
  await page.getByRole('button', { name: `Focus ${onboardingSeed.action}` }).click();
  await expect(page.getByRole('region', { name: committedRegion })).toContainText('1 / 5');

  await page.reload();
  await expect(page.getByRole('region', { name: committedRegion })).toContainText('1 / 5');
  await expect(page.getByRole('region', { name: committedRegion })).toContainText(
    onboardingSeed.action
  );
});

test('completing an Action moves it out of the open list', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/');

  await expect(page.getByRole('region', { name: openRegion })).toContainText(onboardingSeed.action);
  await page.getByRole('button', { name: `Complete ${onboardingSeed.action}` }).click();

  await expect(page.getByRole('button', { name: `Complete ${onboardingSeed.action}` })).toHaveCount(
    0
  );
  await expect(page.getByRole('region', { name: openRegion })).toContainText(
    'No more open Actions.'
  );
});

test('the daily cap limits what is highlighted, not what can exist', async ({ workspace }) => {
  const { page } = workspace;

  // Onboarding leaves one Action. Add five more weekly Actions so there are six
  // candidates against a cap of five: creating the sixth has to be allowed, and
  // only the sixth commitment should be refused.
  await goTo(page, '/planner');
  const goalRow = page
    .getByRole('region', { name: 'Goal hierarchy' })
    .getByText(onboardingSeed.goal);
  await expect(goalRow).toBeVisible();

  await page.getByRole('button', { name: 'Add Quarterly' }).click();
  await page.getByRole('textbox', { name: 'Quarterly goal' }).fill('Capacity quarter');
  await page.getByRole('button', { name: 'Save quarterly goal', exact: true }).click();

  await page.getByRole('button', { name: 'Add Monthly' }).click();
  await page.getByRole('textbox', { name: 'Monthly action' }).fill('Capacity month');
  await page.getByRole('button', { name: 'Save monthly action', exact: true }).click();

  for (let index = 1; index <= 5; index += 1) {
    await page.getByRole('button', { name: 'Add Weekly' }).click();
    await page.getByRole('textbox', { name: 'Weekly action' }).fill(`Capacity action ${index}`);
    await page.getByRole('button', { name: 'Save weekly action', exact: true }).click();
    await expect(page.getByText(`Capacity action ${index}`)).toBeVisible();
  }

  await goTo(page, '/');
  const committed = page.getByRole('region', { name: committedRegion });

  for (const title of [
    onboardingSeed.action,
    'Capacity action 1',
    'Capacity action 2',
    'Capacity action 3',
    'Capacity action 4',
  ]) {
    await page.getByRole('button', { name: `Focus ${title}` }).click();
  }

  await expect(committed).toContainText('5 / 5');
  await expect(page.getByRole('region', { name: openRegion })).toContainText('Capacity action 5');
  await expect(page.getByRole('button', { name: 'Focus Capacity action 5' })).toBeDisabled();
});
