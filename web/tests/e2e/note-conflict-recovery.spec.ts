import AxeBuilder from '@axe-core/playwright';

import { test, expect, goTo, signIn, waitForHydration } from './support/workspace';

/* The conflict surface only exists while a conflict does, so the ordinary axe
   sweep never reaches it -- it walks routes, and this is a state. A new screen
   that is only ever met by someone already in trouble is the last place an
   accessibility failure should be allowed to hide, so the scan happens here,
   with the panel actually on screen.

   The other version comes from a second signed-in session rather than a direct
   database write. service_role is deliberately denied direct access to
   `public.notes` -- widening that for a test would weaken the thing stage0
   security exists to assert -- and a second session is the honest simulation
   anyway: it is literally the other tab this feature is about. */

async function createNote(page: import('@playwright/test').Page, title: string, body: string) {
  const before = page.url();
  await page.getByRole('button', { name: 'New root note' }).click();
  await expect(page).toHaveURL((url) => url.href !== before && /\/notes\?note=/.test(url.href));
  await page.getByRole('textbox', { name: 'Note title' }).fill(title);
  await page.getByRole('textbox', { name: 'Note body, Markdown' }).fill(body);
  await expect(page.getByRole('status')).toHaveText('Saved');
  const id = new URL(page.url()).searchParams.get('note');
  expect(id).toBeTruthy();
  return id as string;
}

/* The other session. A separate context so it carries its own cookies, signed
   in as the same person -- which is what a second device is. */
async function saveElsewhere(
  browser: import('@playwright/test').Browser,
  email: string,
  noteId: string,
  body: string
) {
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await signIn(other, email);
    await other.goto(`/notes?note=${noteId}`);
    await waitForHydration(other);
    await other.getByRole('textbox', { name: 'Note body, Markdown' }).fill(body);
    await expect(other.getByRole('status')).toHaveText('Saved');
  } finally {
    await context.close();
  }
}

test('a Note saved somewhere else can be compared and resolved without losing either version', async ({
  workspace,
  browser,
}) => {
  const { page } = workspace;

  await goTo(page, '/notes');
  await waitForHydration(page);
  const noteId = await createNote(page, 'Retrieval rewrite', 'One\nTwo\nThree');

  // Somebody else -- another tab, another device -- saves the same Note.
  await saveElsewhere(browser, workspace.email, noteId, 'One\nTwo changed elsewhere\nThree');

  // Now this person keeps writing, against a version that no longer exists.
  await page.getByRole('textbox', { name: 'Note body, Markdown' }).fill('One\nTwo mine\nThree');

  const conflict = page.getByRole('alert', { name: 'Version conflict' });
  await expect(conflict).toBeVisible({ timeout: 20_000 });

  // The count is what tells someone whether to read closely or just keep
  // their own, so it has to be right rather than merely present.
  await expect(conflict).toContainText('1 line differs');

  // Both versions are legible, side by side. Neither has been applied yet.
  await expect(conflict).toContainText('Two mine');
  await expect(conflict).toContainText('Two changed elsewhere');
  // The editor still holds exactly what was typed: nothing is rewritten
  // underneath the person while they decide.
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(
    'One\nTwo mine\nThree'
  );

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  await conflict.getByRole('button', { name: 'Keep what I wrote' }).click();

  // Choosing is an ordinary save: the panel goes, the words stay, and the
  // decision survives a reload rather than living in this tab.
  await expect(conflict).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('Saved');
  await goTo(page, '/');
  await page.goto(`/notes?note=${noteId}`);
  await waitForHydration(page);
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(
    'One\nTwo mine\nThree'
  );
});

test('taking the stored version replaces the editor instead of asking for a refresh', async ({
  workspace,
  browser,
}) => {
  const { page } = workspace;

  await goTo(page, '/notes');
  await waitForHydration(page);
  const noteId = await createNote(page, 'Weekly agenda', 'Original line');

  await saveElsewhere(browser, workspace.email, noteId, 'Their line');

  await page.getByRole('textbox', { name: 'Note body, Markdown' }).fill('My line');
  const conflict = page.getByRole('alert', { name: 'Version conflict' });
  await expect(conflict).toBeVisible({ timeout: 20_000 });

  await conflict.getByRole('button', { name: 'Use the saved version' }).click();

  /* The whole point of this surface is that recovering never requires the
     refresh that discards the draft, so taking the other side has to put the
     stored text into the editor directly. */
  await expect(conflict).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(
    'Their line'
  );
  await expect(page.getByRole('status')).toHaveText('Saved');
});
