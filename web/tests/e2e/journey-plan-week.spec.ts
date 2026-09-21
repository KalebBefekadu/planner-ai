import { test, expect, goTo } from './support/workspace';

/* "Help me plan this week" is offered only while the week is still a draft,
   and never writes on arrival. As with choosing a day, the test environment
   has no provider, so this is the outage case -- the one that has to hold. */

test('planning the week by hand is unaffected when the proposal fails', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/planner/week');

  /* Wait for the worksheet itself before pressing anything. Clicking into a
     page whose session has not settled tests an auth race rather than the
     outage this journey is about. */
  const intentionBox = page.getByLabel('What matters this week');
  await expect(intentionBox).toBeVisible({ timeout: 30_000 });

  const propose = page.getByRole('region', { name: 'Help me plan this week' });
  await expect(propose).toBeVisible();
  // Nothing asked for, nothing written.
  await expect(propose).toContainText('nothing is saved until you apply it');

  await propose.getByRole('button', { name: 'Propose a week' }).click();

  // With no provider reachable the page says so and the week is untouched.
  await expect(page.getByRole('region', { name: 'Help me plan this week' })).toBeVisible({
    timeout: 30_000,
  });

  // The intention box is still the person's own, and still saves by hand.
  await intentionBox.fill('Finish the house tidy and pick a course.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(intentionBox).toHaveValue('Finish the house tidy and pick a course.');
});
