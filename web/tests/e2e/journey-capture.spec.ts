import { test, expect, goTo } from './support/workspace';

// Journey 1 of the delivery rule: a thought arrives and is kept exactly as it
// was said. Everything downstream depends on this step being lossless, so the
// assertions here are about preservation rather than presentation.

test('a typed Capture is saved verbatim and appears in the inbox history', async ({
  workspace,
}) => {
  const { page } = workspace;
  // Deliberately messy: trailing thought, lowercase start, no punctuation. The
  // product promise is that nothing tidies this up.
  const raw = 'call the accountant about the q3 filing before friday, and maybe ask about mileage';

  await goTo(page, '/inbox');
  await page.getByRole('textbox', { name: 'Unstructured capture' }).fill(raw);

  const save = page.getByRole('button', { name: 'Save capture' });
  await expect(save).toBeEnabled();
  await save.click();

  const history = page.getByRole('complementary', { name: 'Inbox history' });
  await expect(history.getByText(raw, { exact: true })).toBeVisible();

  // The composer clears so the next thought does not append to the last one.
  await expect(page.getByRole('textbox', { name: 'Unstructured capture' })).toHaveValue('');
});

test('an empty Capture cannot be saved', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/inbox');

  await expect(page.getByRole('button', { name: 'Save capture' })).toBeDisabled();

  // Whitespace is not a thought. Saving it would put an empty row in the inbox
  // that a person then has to notice and clear.
  await page.getByRole('textbox', { name: 'Unstructured capture' }).fill('   ');
  await expect(page.getByRole('button', { name: 'Save capture' })).toBeDisabled();
});

test('a Capture survives a reload, because it is stored rather than held in the page', async ({
  workspace,
}) => {
  const { page } = workspace;
  const raw = 'the onboarding email should mention the keyboard shortcuts';

  await goTo(page, '/inbox');
  await page.getByRole('textbox', { name: 'Unstructured capture' }).fill(raw);
  await page.getByRole('button', { name: 'Save capture' }).click();
  // Assert against the stored history, not the page as a whole: the editor
  // still holds the same words until it is cleared, so an unscoped match can
  // resolve to the draft a person just typed instead of the Capture that was
  // saved -- which is the opposite of what this test is for.
  const history = page.getByLabel('Inbox history');
  await expect(history.getByText(raw, { exact: true })).toBeVisible();

  await page.reload();
  await expect(history.getByText(raw, { exact: true })).toBeVisible();
});

test('Captures reach Today, so nothing is captured into a place nobody looks', async ({
  workspace,
}) => {
  const { page } = workspace;
  const raw = 'decide whether the beta needs a status page';

  await goTo(page, '/inbox');
  await page.getByRole('textbox', { name: 'Unstructured capture' }).fill(raw);
  await page.getByRole('button', { name: 'Save capture' }).click();
  await expect(page.getByLabel('Inbox history').getByText(raw, { exact: true })).toBeVisible();

  await goTo(page, '/');
  const recent = page.getByRole('region', { name: 'Recent captures' });
  await expect(recent.getByText(raw, { exact: true })).toBeVisible();
});

// The Capture inbox has always been able to hand a thought to the model. What
// it could not do was let a person file that thought themselves. These tests
// exist because a Capture that can only move forward through AI is a Capture
// that stops moving whenever the model is off, unavailable, or simply not
// wanted -- and the raw thought is the one thing the product promises to keep.

test('a saved Capture is filed as a Note by hand, with the words kept exactly', async ({
  workspace,
}) => {
  const { page } = workspace;
  // Two lines on purpose: the first becomes the Note title, and the whole
  // thing -- second line included -- has to survive into the body.
  const raw = 'rewrite the pricing page intro\nDana said the second paragraph buries the offer';

  await goTo(page, '/inbox');
  await page.getByRole('textbox', { name: 'Unstructured capture' }).fill(raw);
  await page.getByRole('button', { name: 'Save capture' }).click();

  const entry = page.getByRole('article').filter({ hasText: 'rewrite the pricing page intro' });
  await entry.getByRole('button', { name: 'File as Note' }).click();
  await expect(entry.getByText('Filed as a Note')).toBeVisible();

  await goTo(page, '/notes');
  await page
    .getByRole('navigation', { name: 'Notes' })
    .getByRole('button', { name: 'rewrite the pricing page intro', exact: true })
    .click();
  // The body is asserted whole rather than by its first line: a filing step
  // that quietly dropped the trailing thought would still pass a title check.
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(raw);
});

test('a saved Capture is filed as an Action by hand and shows up on Today', async ({
  workspace,
}) => {
  const { page } = workspace;
  const raw = 'book the venue deposit before the quote expires';

  await goTo(page, '/inbox');
  await page.getByRole('textbox', { name: 'Unstructured capture' }).fill(raw);
  await page.getByRole('button', { name: 'Save capture' }).click();

  const entry = page.getByRole('article').filter({ hasText: raw });
  await entry.getByRole('button', { name: 'File as Action' }).click();
  await expect(entry.getByText('Filed as an Action')).toBeVisible();

  // Filing has to land somewhere a person actually looks. An Action nobody
  // sees is the same failure as never filing it.
  await goTo(page, '/');
  // Scoped to the open Action list rather than the page: the same words are
  // also on screen under Recent captures, and matching those would prove only
  // that the Capture still exists.
  const open = page.getByRole('region', { name: 'Open Actions' });
  await expect(open.getByText(raw, { exact: true })).toBeVisible();
});

test('a Capture filed as an Action still reads as filed after a reload', async ({ workspace }) => {
  const { page } = workspace;
  const raw = 'renew the parking permit before the month turns over';

  await goTo(page, '/inbox');
  await page.getByRole('textbox', { name: 'Unstructured capture' }).fill(raw);
  await page.getByRole('button', { name: 'Save capture' }).click();

  const entry = page.getByRole('article').filter({ hasText: raw });
  await entry.getByRole('button', { name: 'File as Action' }).click();
  await expect(entry.getByText('Filed as an Action')).toBeVisible();

  // The reload is the whole test. Before this change the Capture stayed in
  // state 'new', so the inbox went on presenting work that had already been
  // filed as though nothing had been done with it -- and an inbox whose state
  // is not trusted stops being read.
  await page.reload();
  const reloaded = page.getByRole('article').filter({ hasText: raw });
  await expect(reloaded.getByText('Filed', { exact: true })).toBeVisible();

  // The words themselves are untouched by filing.
  await expect(reloaded.getByText(raw, { exact: true })).toBeVisible();
});

test('filing the same Capture twice does not create a second record', async ({ workspace }) => {
  const { page } = workspace;
  const raw = 'ask the landlord about the roof inspection';

  await goTo(page, '/inbox');
  await page.getByRole('textbox', { name: 'Unstructured capture' }).fill(raw);
  await page.getByRole('button', { name: 'Save capture' }).click();

  const entry = page.getByRole('article').filter({ hasText: raw });
  await entry.getByRole('button', { name: 'File as Note' }).click();
  await expect(entry.getByText('Filed as a Note')).toBeVisible();

  // A person who reloads and files again -- or double-taps on a slow phone --
  // must not end up with two Notes holding the same thought.
  await page.reload();
  const again = page.getByRole('article').filter({ hasText: raw });
  await again.getByRole('button', { name: 'File as Note' }).click();
  await expect(again.getByText('Filed as a Note')).toBeVisible();

  await goTo(page, '/notes');
  await expect(
    page.getByRole('navigation', { name: 'Notes' }).getByRole('button', { name: raw, exact: true })
  ).toHaveCount(1);
});
