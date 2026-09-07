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
