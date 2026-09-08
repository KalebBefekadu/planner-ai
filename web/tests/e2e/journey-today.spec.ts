import { test, expect, goTo, onboardingSeed } from './support/workspace';

// Journey 4 of the delivery rule: deciding what today is actually for. The
// product's opinion here is that a day holds a small number of commitments,
// and that the cap limits what you highlight without limiting what you create.

const committedRegion = 'Committed Actions';
const openRegion = 'Open Actions';

test('Planner navigation keeps Today inside the planning workflow', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/planner');

  const plannerNavigation = page.getByRole('complementary', { name: 'Planner navigation' });
  if (!(await plannerNavigation.isVisible())) {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
  await plannerNavigation.getByRole('link', { name: 'Today', exact: true }).click();

  await expect(page).toHaveURL(/\/planner\/today(?:\?|$)/);
  await expect(page.getByRole('heading', { name: 'Make today count', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Planning views' })).toBeVisible();
});

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
  await expect(page.getByRole('region', { name: onboardingSeed.goal })).toContainText(
    'Your focused work advances this goal.'
  );
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
    // Confirm against the hierarchy, not the page: the form still holds the
    // same words until it is cleared, so an unscoped match can be satisfied by
    // the text just typed and the loop moves on having saved nothing.
    await expect(
      page.getByRole('region', { name: 'Goal hierarchy' }).getByText(`Capacity action ${index}`)
    ).toBeVisible();
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
    // Committing an Action moves it out of the open list and into this region,
    // so the next control only settles once that move has happened. Clicking
    // straight through the re-render drops a commitment and the cap then looks
    // like it refused something it never received.
    await expect(committed).toContainText(title);
  }

  await expect(committed).toContainText('5 / 5');
  await expect(page.getByRole('region', { name: openRegion })).toContainText('Capacity action 5');
  await expect(page.getByRole('button', { name: 'Focus Capacity action 5' })).toBeDisabled();
});

// PL-05: adding work from Today. The point of the composer is that a person
// can put something on today without first building a hierarchy or asking the
// assistant, and that what they see afterwards is the truth about what was
// saved and what was committed.

test('an Action created from Today survives a reload and can be completed there', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/');

  const composer = page.getByRole('region', { name: 'New Action' });
  await composer.getByRole('textbox', { name: 'What needs doing' }).fill('Book the venue');
  await composer.getByRole('checkbox', { name: "Commit to today's focus" }).uncheck();
  await composer.getByRole('button', { name: 'Add Action' }).click();

  await expect(composer).toContainText('"Book the venue" is saved to your open Actions.');
  await expect(page.getByRole('region', { name: openRegion })).toContainText('Book the venue');

  await page.reload();
  await expect(page.getByRole('region', { name: openRegion })).toContainText('Book the venue');

  await page.getByRole('button', { name: 'Complete Book the venue' }).click();
  await expect(page.getByRole('button', { name: 'Complete Book the venue' })).toHaveCount(0);
});

test('an Action created from Today can be linked to a real Goal and committed at once', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/');

  const composer = page.getByRole('region', { name: 'New Action' });
  await composer.getByRole('textbox', { name: 'What needs doing' }).fill('Draft the invite copy');
  await composer
    .getByRole('combobox', { name: 'Goal' })
    .selectOption({ label: onboardingSeed.goal });
  await composer.getByRole('button', { name: 'Add Action' }).click();

  const committed = page.getByRole('region', { name: committedRegion });
  await expect(committed).toContainText('Draft the invite copy');
  await expect(committed).toContainText('1 / 5');

  await page.reload();
  await expect(page.getByRole('region', { name: committedRegion })).toContainText(
    'Draft the invite copy'
  );
  // The Goal it was linked to travels with it, so today keeps its line back to
  // the larger plan.
  await expect(page.getByRole('region', { name: committedRegion })).toContainText(
    onboardingSeed.goal
  );
});

test('a full focus list keeps the new Action and refuses only the commitment', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/');

  const composer = page.getByRole('region', { name: 'New Action' });
  const committed = page.getByRole('region', { name: committedRegion });

  // Fill the day to its cap using the composer itself.
  for (let index = 1; index <= 4; index += 1) {
    await composer.getByRole('textbox', { name: 'What needs doing' }).fill(`Committed ${index}`);
    await composer.getByRole('button', { name: 'Add Action' }).click();
    await expect(committed).toContainText(`Committed ${index}`);
  }
  await page.getByRole('button', { name: `Focus ${onboardingSeed.action}` }).click();
  await expect(committed).toContainText('5 / 5');

  await composer.getByRole('textbox', { name: 'What needs doing' }).fill('Overflow work');
  await composer.getByRole('button', { name: 'Add Action' }).click();

  await expect(composer).toContainText("Today's focus is already full at 5");
  // Nothing that was already committed was dropped to make room.
  await expect(committed).toContainText('5 / 5');
  await expect(committed).toContainText(onboardingSeed.action);
  await expect(page.getByRole('region', { name: openRegion })).toContainText('Overflow work');
});

test('a saved Action is written once and the composer clears itself', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/');

  const composer = page.getByRole('region', { name: 'New Action' });
  const title = composer.getByRole('textbox', { name: 'What needs doing' });
  await title.fill('Only once');
  await composer.getByRole('button', { name: 'Add Action' }).click();
  await expect(composer).toContainText('"Only once" is saved');

  // A cleared title is what stops the next keystroke from resubmitting the
  // same words, and one reload proves the submission wrote a single row.
  await expect(title).toHaveValue('');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Complete Only once' })).toHaveCount(1);
});
