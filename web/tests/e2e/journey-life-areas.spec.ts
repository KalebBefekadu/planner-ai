import { test, expect, goTo } from './support/workspace';

/* The owner acceptance journey for life areas, in the order someone actually
   does it: name an area, find its page in Notes, write what it is for, put a
   task in it, add a subarea, see the task roll up, and archive without losing
   anything. Each step is the evidence for one promise the redesign makes. */

test('an area is created from a name alone and gets exactly one page', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/areas');

  await page.getByRole('button', { name: 'Add a life area' }).click();
  await page.getByLabel('Name of the new life area').fill('Health');
  await page.getByLabel('Name of the new life area').press('Enter');

  await expect(page).toHaveURL(/\/areas\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Health', level: 1 })).toBeVisible();

  // The page is an ordinary Note, reachable from Notes, and there is one.
  await page.getByRole('link', { name: 'Notes', exact: true }).first().click();
  await expect(page.getByRole('link', { name: /Open in Notes/ })).toBeVisible();

  await goTo(page, '/notes');
  await expect(page.getByRole('button', { name: 'Health', exact: true })).toHaveCount(1);
});

test('an area holds its own direction, and a subarea sees it without copying it', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/areas');
  await page.getByRole('button', { name: 'Add a life area' }).click();
  await page.getByLabel('Name of the new life area').fill('Health');
  await page.getByLabel('Name of the new life area').press('Enter');
  await expect(page).toHaveURL(/\/areas\/[0-9a-f-]{36}/, { timeout: 30_000 });

  await page.getByLabel('What Health is for').fill('Strong enough to keep up.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Strong enough to keep up.')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Add a subarea under Health' }).click();
  await page.getByLabel('Name of the new subarea under Health').fill('Movement');
  await page.getByLabel('Name of the new subarea under Health').press('Enter');
  await expect(page.getByRole('heading', { name: 'Movement', level: 1 })).toBeVisible({
    timeout: 30_000,
  });

  // Shown as context, under the parent's name -- not pre-filled into the
  // subarea's own editor, which would be a second copy to keep in step.
  await expect(page.getByText(/Under\s+Health/)).toBeVisible();
  await expect(page.getByLabel('What Movement is for')).toHaveValue('');
});

test('a task typed into a subarea rolls up to its parent and can be narrowed', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/areas');
  await page.getByRole('button', { name: 'Add a life area' }).click();
  await page.getByLabel('Name of the new life area').fill('Health');
  await page.getByLabel('Name of the new life area').press('Enter');
  await expect(page).toHaveURL(/\/areas\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const parentUrl = page.url();

  await page.getByRole('button', { name: 'Add a subarea under Health' }).click();
  await page.getByLabel('Name of the new subarea under Health').fill('Movement');
  await page.getByLabel('Name of the new subarea under Health').press('Enter');
  await expect(page.getByRole('heading', { name: 'Movement', level: 1 })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByPlaceholder('What needs doing in Movement?').fill('Book the running session');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText('Book the running session')).toBeVisible({ timeout: 30_000 });

  // The same task, seen from the parent. One task, not a copy.
  await page.goto(parentUrl);
  await expect(page.getByText('Book the running session')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('link', { name: 'This area only' }).click();
  await expect(page).toHaveURL(/scope=self/);
  await expect(page.getByText('Book the running session')).toHaveCount(0);
});

test('archiving hides an area from the list without cancelling its work', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/areas');
  await page.getByRole('button', { name: 'Add a life area' }).click();
  await page.getByLabel('Name of the new life area').fill('Health');
  await page.getByLabel('Name of the new life area').press('Enter');
  await expect(page).toHaveURL(/\/areas\/[0-9a-f-]{36}/, { timeout: 30_000 });

  await page.getByPlaceholder('What needs doing in Health?').fill('Book the running session');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText('Book the running session')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Archive area' }).click();
  await expect(page.getByText(/archiving organises, it does not cancel/)).toBeVisible({
    timeout: 30_000,
  });

  // Still scheduled, still on Today. Archive is organisation, not cancellation.
  await goTo(page, '/planner/today');
  await expect(page.getByText('Book the running session').first()).toBeVisible();

  await goTo(page, '/areas');
  await expect(page.getByRole('link', { name: 'Health', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Show archived areas' }).click();
  await expect(page.getByRole('link', { name: 'Health', exact: true })).toHaveCount(1);
});

test('renaming an area offers to rename its page, and the page keeps its identity', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/areas');
  await page.getByRole('button', { name: 'Add a life area' }).click();
  await page.getByLabel('Name of the new life area').fill('Health');
  await page.getByLabel('Name of the new life area').press('Enter');
  await expect(page).toHaveURL(/\/areas\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const areaUrl = page.url();

  await page.getByRole('button', { name: 'Rename this area' }).click();
  // Offered, and on by default only because the page still carries the area's
  // own name.
  await expect(page.getByLabel('Also rename its page')).toBeChecked();
  await page.getByLabel('Area name').fill('Wellbeing');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Wellbeing', level: 1 })).toBeVisible({
    timeout: 30_000,
  });

  // The same page, renamed -- not a second one.
  await goTo(page, '/notes');
  await expect(page.getByRole('button', { name: 'Wellbeing', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Health', exact: true })).toHaveCount(0);

  await page.goto(areaUrl);
  await expect(page.getByRole('heading', { name: 'Wellbeing', level: 1 })).toBeVisible();
});
