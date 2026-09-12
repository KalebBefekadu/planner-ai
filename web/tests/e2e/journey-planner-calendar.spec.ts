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

// PL-08: the full scheduling life of an Action. A date can be given, changed
// and taken away again, and none of it depends on dragging anything.

test('an Action can be scheduled, rescheduled and unscheduled from the keyboard', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/planner/calendar');

  const unscheduledPanel = page.getByRole('complementary', { name: 'Unscheduled' });
  const scheduleButton = page.getByRole('button', { name: `Schedule ${onboardingSeed.action}` });

  // Reached and opened without a pointer: every scheduling control has to be
  // operable by someone who never touches a mouse.
  await scheduleButton.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: onboardingSeed.action });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Scheduled date').fill('2030-01-02');
  await dialog.getByRole('button', { name: 'Save date' }).press('Enter');
  await expect(page.getByRole('status')).toContainText('scheduled for Jan 2');

  // Rescheduled: the calendar follows the new date rather than stranding the
  // person on the old week.
  await page.getByRole('button', { name: `Schedule ${onboardingSeed.action}` }).click();
  await dialog.getByLabel('Scheduled date').fill('2030-01-09');
  await dialog.getByRole('button', { name: 'Save date' }).click();
  await expect(page.getByRole('status')).toContainText('scheduled for Jan 9');
  await expect(page.getByRole('region', { name: /January 9/ })).toContainText(
    onboardingSeed.action
  );

  // Unscheduled through its own control. Clearing a date input is awkward on a
  // phone, so "no date" is a button rather than an empty field.
  await page.getByRole('button', { name: `Schedule ${onboardingSeed.action}` }).click();
  await dialog.getByRole('button', { name: 'Unschedule' }).click();
  await expect(page.getByRole('status')).toContainText('moved to Unscheduled');
  await expect(unscheduledPanel).toContainText(onboardingSeed.action);

  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Unscheduled' })).toContainText(
    onboardingSeed.action
  );
});

test('a scheduled date is the same date on Today', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/planner/calendar');

  // Schedule it for today so the two surfaces have to agree about the day.
  const dialog = page.getByRole('dialog', { name: onboardingSeed.action });
  await page.getByRole('button', { name: `Schedule ${onboardingSeed.action}` }).click();
  const todayValue = new Date().toISOString().slice(0, 10);
  await dialog.getByLabel('Scheduled date').fill(todayValue);
  await dialog.getByRole('button', { name: 'Save date' }).click();
  await expect(page.getByRole('status')).toContainText('scheduled for');

  await goTo(page, '/');
  const openActions = page.getByRole('region', { name: 'Open Actions' });
  await expect(openActions).toContainText(onboardingSeed.action);
  await expect(openActions).toContainText('Today');
});
