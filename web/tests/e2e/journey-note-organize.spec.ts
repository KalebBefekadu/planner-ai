import { test, expect, goTo } from './support/workspace';

/* Organising writing is the first contextual intent that touches something the
   owner wrote rather than something the product generated. The promise is
   narrow and worth proving on screen: the suggestion is an offer, the page is
   unchanged until it is accepted, and what it puts back is the person's own
   words.

   The provider is mocked. What is under test is the product's half of the
   contract -- the offer, the refusal, the acceptance, and the exclusion that
   stops the page being sent at all. */

const LINES = [
  '- Call the roofer back',
  '- Book the MOT',
  '- Ask Sam about the loft insulation quote',
  '- Renew the parking permit',
];

const ARRANGED = [
  '## House',
  '',
  '- Call the roofer back',
  '- Ask Sam about the loft insulation quote',
  '',
  '## Car',
  '',
  '- Book the MOT',
  '- Renew the parking permit',
  '',
].join('\n');

async function newNote(page: import('@playwright/test').Page, title: string, body: string) {
  const before = page.url();
  await page.getByRole('button', { name: 'New root note' }).click();
  await expect(page).toHaveURL((url) => url.href !== before && /\/notes\?note=/.test(url.href));
  await page.getByRole('textbox', { name: 'Note title' }).fill(title);
  await page.getByRole('textbox', { name: 'Note body, Markdown' }).fill(body);
  await expect(page.getByRole('status').first()).toHaveText('Saved', { timeout: 30_000 });
}

test('a suggested arrangement is an offer, and the page is unchanged until it is taken', async ({
  workspace,
}) => {
  const { page } = workspace;
  await page.route('**/api/note-organize', (route) =>
    route.fulfill({
      json: { markdown: ARRANGED, unsorted: 0, invented: [], questions: [] },
    })
  );

  await goTo(page, '/notes');
  await newNote(page, 'Jobs to do', LINES.join('\n'));

  const body = page.getByRole('textbox', { name: 'Note body, Markdown' });
  await page.getByRole('button', { name: 'Organize this writing' }).click();

  const panel = page.getByRole('region', { name: 'Proposed arrangement' });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel).toContainText('## House');

  // Refusing costs nothing: the editor never changed while the offer was open.
  await expect(body).toHaveValue(LINES.join('\n'));
  await panel.getByRole('button', { name: 'Leave it as it is' }).click();
  await expect(panel).toBeHidden();
  await expect(body).toHaveValue(LINES.join('\n'));

  await page.getByRole('button', { name: 'Organize this writing' }).click();
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.getByRole('button', { name: 'Use this arrangement' }).click();
  await expect(body).toHaveValue(ARRANGED);
  await expect(page.getByRole('status').first()).toHaveText('Saved', { timeout: 30_000 });

  // Every line is still the person's own, and none of them was lost.
  for (const line of LINES) await expect(body).toHaveValue(new RegExp(escape(line)));

  // And the writing before it is still there to go back to.
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(ARRANGED);
});

test('a page excluded from AI is not offered to be arranged', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/notes');
  await newNote(page, 'Private thinking', LINES.join('\n'));

  await expect(page.getByRole('button', { name: 'Organize this writing' })).toBeVisible();
  /* Clicked rather than `check()`ed: the control is driven by what the server
     last said, so it does not report itself as checked until the write has
     come back, and `check()` asserts that state immediately. */
  await page.getByLabel('Exclude from AI').click();
  await expect(page.getByRole('button', { name: 'Organize this writing' })).toBeHidden({
    timeout: 30_000,
  });
});

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
