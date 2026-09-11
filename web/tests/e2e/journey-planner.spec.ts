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

  const horizons = page.getByRole('group', { name: 'Filter plan by horizon' });
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

// PL-07: a Planning Horizon is a time boundary, not a category. "Week" used to
// return every weekly Action ever created, so the filter named a period it did
// not apply.

function isoDaysFromToday(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('the period filter excludes other periods without hiding the work', async ({ workspace }) => {
  const { page } = workspace;

  // Create work in a week that is definitely not this one. Sixty days out
  // crosses at least one month boundary, so it lands in a different week and
  // a different month.
  await goTo(page, '/');
  const composer = page.getByRole('region', { name: 'New Action' });
  await composer.getByRole('textbox', { name: 'What needs doing' }).fill('Work for a later week');
  await composer.getByRole('textbox', { name: 'Scheduled date' }).fill(isoDaysFromToday(60));
  await composer.getByRole('button', { name: 'Add Action' }).click();
  await expect(composer).toContainText('is saved');

  await page.goto('/planner');
  const horizons = page.getByRole('group', { name: 'Filter plan by horizon' });
  const weekTab = horizons.getByRole('button', { name: /^Week/ });
  const monthTab = horizons.getByRole('button', { name: /^Month/ });

  // Onboarding leaves one Action in this month, which the current period
  // keeps. The Action sixty days out is real and saved, and is not part of
  // this week -- which is the whole distinction the filter exists to make.
  await expect(monthTab).toContainText('1');
  await expect(weekTab).toContainText('0');
  await expect(page.getByText(/item is outside this period/)).toBeVisible();

  // Filtered, never hidden: one control brings all of it back.
  await page.getByRole('button', { name: 'Show all time' }).click();
  await expect(page).toHaveURL(/period=all/);
  await expect(weekTab).toContainText('1');
  await expect(monthTab).toContainText('1');
});

test('the chosen period and horizon survive reload, back and forward', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/planner');

  const periods = page.getByRole('group', { name: 'Filter plan by period' });
  await expect(periods.getByRole('button', { name: 'This period' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  await periods.getByRole('button', { name: 'All time' }).click();
  await expect(page).toHaveURL(/period=all/);

  // The filters are in the URL, so a filtered plan can be bookmarked and
  // reached with browser history instead of resetting on every reload.
  await page.reload();
  await expect(periods.getByRole('button', { name: 'All time' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  await page.goBack();
  await expect(periods.getByRole('button', { name: 'This period' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('choosing a horizon names the actual period it covers', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/planner');

  await page
    .getByRole('group', { name: 'Filter plan by horizon' })
    .getByRole('button', { name: /^Week/ })
    .click();
  await expect(page).toHaveURL(/horizon=weekly/);

  // A date range rather than the word "Week": the point is that the filter
  // now refers to a period a person can check against a calendar.
  await expect(page.getByText(/^[A-Z][a-z]{2} \d+ - [A-Z][a-z]{2} \d+$/)).toBeVisible();

  await page.reload();
  await expect(
    page
      .getByRole('group', { name: 'Filter plan by horizon' })
      .getByRole('button', { name: /^Week/ })
  ).toHaveAttribute('aria-pressed', 'true');
});

test('the sidebar marks the planner destination that was chosen', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/planner');

  const sidebar = page.getByRole('navigation', { name: 'Planner' });
  const thisWeek = sidebar.getByRole('link', { name: 'This week', exact: true });
  const goals = sidebar.getByRole('link', { name: 'Goals & horizons', exact: true });

  await expect(thisWeek).toHaveAttribute('aria-current', 'page');
  await expect(goals).not.toHaveAttribute('aria-current', 'page');

  /* Goals & horizons used to point at /goals, a permanent redirect to
     /planner, so choosing it landed on the page This week is marked as and
     the sidebar claimed you were somewhere you had not clicked. */
  await goals.click();
  await expect(page).toHaveURL(/\/planner\?period=all/);
  await expect(
    sidebar.getByRole('link', { name: 'Goals & horizons', exact: true })
  ).toHaveAttribute('aria-current', 'page');
  await expect(sidebar.getByRole('link', { name: 'This week', exact: true })).not.toHaveAttribute(
    'aria-current',
    'page'
  );

  // And the page it lands on is actually showing every period.
  await expect(page.getByText('Every period on record')).toBeVisible();
});
