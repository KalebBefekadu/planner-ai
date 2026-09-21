import { test, expect, goTo } from './support/workspace';

/* The schema had outcomes and it had initiatives, and neither is what people
   mean by a project. This is the evidence that a bounded piece of work can be
   started, can say what finishing it means, and can actually finish -- and
   that finishing is reversible, because a project called done too early must
   not be stuck that way. */

test('a project can be started, finished, and reopened', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/areas');

  await page.getByRole('button', { name: 'Add a life area' }).click();
  await page.getByLabel('Name of the new life area').fill('Home');
  await page.getByLabel('Name of the new life area').press('Enter');
  await expect(page).toHaveURL(/\/areas\/[0-9a-f-]{36}/, { timeout: 30_000 });

  await page.getByRole('link', { name: 'Plan', exact: true }).click();

  const projects = page.getByRole('region', { name: 'Projects' });
  await expect(projects).toContainText('No projects here');

  await projects.getByLabel('Project').fill('Repaint the kitchen');
  await projects.getByLabel('What would finishing look like?').fill('Every wall and the trim');
  await projects.getByRole('button', { name: 'Start project' }).click();

  const project = projects.getByRole('listitem').filter({ hasText: 'Repaint the kitchen' });
  await expect(project).toBeVisible({ timeout: 30_000 });
  // The finish condition is shown, because it is the thing that makes it finite.
  await expect(project).toContainText('Done when: Every wall and the trim');
  await expect(project).toContainText('In progress');

  await project.getByRole('button', { name: 'Mark finished' }).click();
  await expect(project).toContainText('Finished', { timeout: 30_000 });

  // Finishing is not a one-way door.
  await project.getByRole('button', { name: 'Reopen' }).click();
  await expect(project).toContainText('In progress', { timeout: 30_000 });
});
