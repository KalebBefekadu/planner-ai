import { test, expect, goTo, onboardingSeed } from './support/workspace';

// Journey 2 of the delivery rule: connecting a direction to the next useful
// thing to do. The cascade is the product's central claim -- that an Action can
// always be traced back to a reason -- so these tests follow it downward.

test('the cascade runs from Vision to a weekly Action', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/planner');

  // The Vision set during onboarding anchors the plan.
  await expect(page.getByText(onboardingSeed.vision)).toBeVisible();

  const hierarchy = page.getByRole('region', { name: 'Goal hierarchy' });
  await expect(hierarchy).toContainText(onboardingSeed.goal);

  await page.getByRole('button', { name: 'Add Quarterly' }).click();
  await page.getByRole('textbox', { name: 'Quarterly goal' }).fill('Close the beta punch list.');
  await page.getByRole('button', { name: 'Save quarterly goal', exact: true }).click();
  await expect(hierarchy).toContainText('Close the beta punch list.');

  await page.getByRole('button', { name: 'Add Monthly' }).click();
  await page.getByRole('textbox', { name: 'Monthly action' }).fill('Fix the top ten defects.');
  await page.getByRole('button', { name: 'Save monthly action', exact: true }).click();
  await expect(hierarchy).toContainText('Fix the top ten defects.');

  await page.getByRole('button', { name: 'Add Weekly' }).click();
  await page.getByRole('textbox', { name: 'Weekly action' }).fill('Triage the defect batch.');
  await page.getByRole('button', { name: 'Save weekly action', exact: true }).click();
  await expect(hierarchy).toContainText('Triage the defect batch.');
});

test('the horizon filter narrows the plan without deleting anything', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/planner');

  const horizons = page.getByRole('navigation', { name: 'Filter plan by horizon' });
  await expect(horizons.getByRole('button', { name: /All horizons/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  // Onboarding creates one yearly Goal and one Action, so filtering to Quarter
  // must empty the view -- and filtering back must restore it. A filter that
  // loses data would show a permanently smaller count on return.
  await horizons.getByRole('button', { name: /^Quarter/ }).click();
  await expect(page.getByRole('region', { name: 'Goal hierarchy' })).not.toContainText(
    onboardingSeed.goal
  );

  await horizons.getByRole('button', { name: /^Year/ }).click();
  await expect(page.getByRole('region', { name: 'Goal hierarchy' })).toContainText(
    onboardingSeed.goal
  );
});

test('the plan reports when a Goal has nothing to measure, and changes nothing', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/planner');

  // The onboarding Goal has no target value, so it is unmeasurable by
  // construction. The product's stance is to say so and stop there.
  const drift = page.getByRole('status').filter({ hasText: 'measure' });
  await expect(drift).toBeVisible();
  await expect(drift).toContainText('Nothing has been changed.');

  // Saying it does not archive, complete, or reword the Goal.
  await expect(page.getByRole('region', { name: 'Goal hierarchy' })).toContainText(
    onboardingSeed.goal
  );
});

test('an achieved Goal stays in the plan and is counted as completed', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/planner');

  const overview = page.getByRole('region', { name: 'Plan overview' });
  const hierarchy = page.getByRole('region', { name: 'Goal hierarchy' });
  await expect(overview.getByText('Completed').locator('..')).toContainText('0');

  await page.getByRole('button', { name: 'Mark yearly goal as complete' }).click();

  // Achieving a Goal used to stamp archived_at, and every planner read filters
  // archived rows out -- so finishing the Goal removed it from the plan and
  // left the Completed tile stuck at zero. Both halves are asserted because
  // the disappearance and the miscount had the same single cause.
  await expect(overview.getByText('Completed').locator('..')).toContainText('1');
  await expect(hierarchy).toContainText(onboardingSeed.goal);
  await expect(hierarchy).not.toContainText('No yearly goals yet');

  await page.reload();
  await expect(overview.getByText('Completed').locator('..')).toContainText('1');
  await expect(hierarchy).toContainText(onboardingSeed.goal);
});
