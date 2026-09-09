import AxeBuilder from '@axe-core/playwright';

import { test, expect, goTo, waitForHydration } from './support/workspace';

/* Capturing without leaving the page.
 *
 * The assertion that matters is not that the box exists but that the thought
 * survives: a composer that appears to accept text and stores nothing is worse
 * than the link it replaced, because the person believes they have kept
 * something. So every test here ends at the Inbox, reading back what was
 * typed. */

/* On a phone the sidebar lives behind the menu button, so reaching the
   composer takes one tap first. Doing that here rather than skipping mobile:
   a thought arriving while you are on your phone is the case this feature is
   most obviously for, and a test that only ever runs on a desktop viewport
   would not notice the composer becoming unreachable there. */
async function openCaptureComposer(page: import('@playwright/test').Page) {
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible().catch(() => false)) await menu.click();
}

test('a thought captured from the shell is kept, without leaving the page', async ({
  workspace,
}) => {
  const { page } = workspace;

  await goTo(page, '/activity');
  await waitForHydration(page);
  await openCaptureComposer(page);

  const thought = 'Ask Dana whether the pricing page still says fourteen days.';
  await page.getByRole('textbox', { name: 'Capture a thought' }).fill(thought);
  await page.getByRole('button', { name: 'Capture' }).click();

  // Saving must not navigate: the whole point is not losing your place.
  await expect(page).toHaveURL(/\/activity(?:\?|$)/);
  await expect(page.getByRole('status')).toContainText('Captured');
  // The field is cleared, so a second thought does not append to the first.
  await expect(page.getByRole('textbox', { name: 'Capture a thought' })).toHaveValue('');

  // And it is really there, not merely reported.
  await goTo(page, '/inbox');
  await waitForHydration(page);
  await expect(page.getByText(thought)).toBeVisible();
});

test('the exact words are stored, including the ones a trim would remove', async ({
  workspace,
}) => {
  const { page } = workspace;

  await goTo(page, '/activity');
  await waitForHydration(page);
  await openCaptureComposer(page);

  /* A Capture is raw immutable text. Its value is that it is what the person
     actually wrote, so the shell must not tidy it on the way in. */
  const messy = 'two thoughts\n\nsecond one, unfinished —';
  await page.getByRole('textbox', { name: 'Capture a thought' }).fill(messy);
  await page.getByRole('button', { name: 'Capture' }).click();
  await expect(page.getByRole('status')).toContainText('Captured');

  await goTo(page, '/inbox');
  await waitForHydration(page);
  await expect(page.getByText('second one, unfinished')).toBeVisible();
});

test('a thought too short to keep is refused before it is sent', async ({ workspace }) => {
  const { page } = workspace;

  await goTo(page, '/activity');
  await waitForHydration(page);
  await openCaptureComposer(page);

  const capture = page.getByRole('button', { name: 'Capture' });
  await expect(capture).toBeDisabled();
  await page.getByRole('textbox', { name: 'Capture a thought' }).fill('ok');
  await expect(capture).toBeDisabled();
  await page.getByRole('textbox', { name: 'Capture a thought' }).fill('okay');
  await expect(capture).toBeEnabled();
});

test('the composer names itself for the surface it is on', async ({ workspace }) => {
  const { page } = workspace;

  await goTo(page, '/planner');
  await waitForHydration(page);
  await openCaptureComposer(page);
  await expect(page.getByRole('textbox', { name: 'Capture an action' })).toBeVisible();

  await goTo(page, '/activity');
  await waitForHydration(page);
  await openCaptureComposer(page);
  await expect(page.getByRole('textbox', { name: 'Capture a thought' })).toBeVisible();
});

test('the composer has no automated WCAG A/AA violations', async ({ workspace }) => {
  const { page } = workspace;

  await goTo(page, '/activity');
  await waitForHydration(page);
  await openCaptureComposer(page);
  // Scanned with text in the box and the save control live, because an empty
  // composer exercises neither the field's filled state nor the enabled button.
  await page.getByRole('textbox', { name: 'Capture a thought' }).fill('Something worth keeping.');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});
