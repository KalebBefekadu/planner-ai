import { test, expect, goTo } from './support/workspace';

/* "What am I neglecting?" is a question the app can answer from dates it
   already holds, so it does, without a model and without a score. The two
   things worth pinning are that it is asked for rather than volunteered, and
   that it says what it is actually measuring: what got written down. */

test('what has gone quiet is asked for, never volunteered', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/goals');

  const quiet = page.getByRole('region', { name: 'Quiet goals' });
  await expect(quiet).toBeVisible();

  // Nothing has been read or listed until someone asks.
  await expect(quiet).toContainText('Asked for rather than shown');
  await expect(quiet.getByRole('listitem')).toHaveCount(0);

  await quiet.getByRole('button', { name: 'Check' }).click();

  // The seeded goal has work against it, so there is nothing to report, and
  // the empty answer is stated rather than left blank.
  await expect(quiet).toContainText(/Every active goal has had work recorded|No work recorded/, {
    timeout: 30_000,
  });
  await expect(quiet.getByRole('button', { name: 'Check' })).toHaveCount(0);
});
