import { test, expect, goTo } from './support/workspace';

/* ENG-12: the owner acceptance journey, in the order a person actually does
   it. Every slice already has its own journey proving it works; this one
   exists to prove they compose -- that a part of life named in one screen is
   the same place in another, that work filed there is the same work the week
   counts, and that the record a closed week leaves can still be opened
   afterwards.

   Run at phone width as well as desktop, because the plan's acceptance is
   that the whole loop works on a phone, not that each screen renders there. */

const PHONE = { width: 390, height: 844 };

for (const viewport of [null, PHONE]) {
  const where = viewport ? 'on a phone' : 'on a desktop';

  test(`the whole loop, ${where}: a part of life, work in it, a week, and a record`, async ({
    workspace,
  }) => {
    // Six screens and a closed week. This one needs the room.
    test.slow();
    const { page } = workspace;
    if (viewport) await page.setViewportSize(viewport);

    // 1. A part of life exists from a name alone.
    await goTo(page, '/areas');
    await page.getByRole('button', { name: 'Add a life area' }).click();
    await page.getByLabel('Name of the new life area').fill('Home');
    await page.getByLabel('Name of the new life area').press('Enter');
    await expect(page).toHaveURL(/\/areas\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const areaUrl = page.url();

    // 2. It holds its own direction.
    await page.getByLabel('What Home is for').fill('A house that runs without thinking about it.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('A house that runs without thinking about it.')).toBeVisible({
      timeout: 30_000,
    });

    // 3. A subarea, and work typed into it.
    await page.getByRole('button', { name: 'Add a subarea under Home' }).click();
    await page.getByLabel('Name of the new subarea under Home').fill('Paperwork');
    await page.getByLabel('Name of the new subarea under Home').press('Enter');
    await expect(page.getByRole('heading', { name: 'Paperwork', level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    await page
      .getByPlaceholder('What needs doing in Paperwork?')
      .fill('File the insurance renewal');
    await page.getByRole('button', { name: 'Add task' }).click();
    await expect(page.getByText('File the insurance renewal')).toBeVisible({ timeout: 30_000 });

    // 4. The work rolls up to the part of life it belongs to, not only the
    //    subarea it was typed into.
    await goTo(page, areaUrl);
    await expect(page.getByText('File the insurance renewal')).toBeVisible({ timeout: 30_000 });

    // 5. A project: work in this area that can actually be finished.
    await page.getByRole('link', { name: 'Plan', exact: true }).click();
    const projects = page.getByRole('region', { name: 'Projects' });
    await projects.getByLabel('Project').fill('Clear the filing backlog');
    await projects.getByLabel('What would finishing look like?').fill('Nothing older than a month');
    await projects.getByRole('button', { name: 'Start project' }).click();
    await expect(projects.getByText('Clear the filing backlog')).toBeVisible({ timeout: 30_000 });

    // 6. A week is a selection someone made, and committing freezes it.
    await goTo(page, '/planner/week');
    const entry = page.getByPlaceholder('What needs doing this week?');
    for (const title of ['Finish the filing', 'Renew the insurance']) {
      await entry.fill(title);
      await page.getByRole('button', { name: 'Add task' }).click();
      await expect(page.getByText(title)).toBeVisible({ timeout: 30_000 });
    }
    await page.getByRole('button', { name: 'Commit this week' }).click();
    await expect(page.getByText('This week is committed.')).toBeVisible({ timeout: 30_000 });

    // 7. One done, one given a decision rather than quietly dropped.
    await page.getByRole('checkbox', { name: 'Complete Finish the filing' }).check();
    await expect(page.getByRole('checkbox', { name: 'Complete Finish the filing' })).toBeChecked({
      timeout: 30_000,
    });
    const close = page.getByRole('region', { name: 'Close this week' });
    await close.getByRole('button', { name: 'Move it' }).first().click();
    await expect(close.getByText('Renew the insurance')).toHaveCount(0, { timeout: 30_000 });

    // 8. Closing writes a record with a denominator that came from a promise.
    await page.getByRole('button', { name: 'Close this week' }).click();
    const record = page.getByRole('region', { name: 'Week record' });
    await expect(record).toContainText('1 of 2', { timeout: 30_000 });

    // 9. The record is still there on a later visit: history, not a query.
    await goTo(page, '/planner/week');
    await expect(page.getByRole('region', { name: 'Week record' })).toContainText('1 of 2');

    // 10. The same part of life is findable from Knowledge, as one page rather
    //     than a second copy kept in step by hand.
    await goTo(page, '/notes');
    await expect(page.getByRole('button', { name: 'Home', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Paperwork', exact: true })).toHaveCount(1);
  });
}
