import { test, expect, goTo } from './support/workspace';

// Journey 5 of the delivery rule: knowledge stays understandable after the
// moment it was written. Notes are not a disposable editor; they preserve
// Markdown, expose deliberate connections, and let a person travel either
// direction through those connections.

async function createRootNote(page: import('@playwright/test').Page, title: string, body: string) {
  await page.getByRole('button', { name: 'New root note' }).click();
  await expect(page).toHaveURL(/\/notes\?note=/);
  const titleEditor = page.getByRole('textbox', { name: 'Note title' });
  await expect(titleEditor).toHaveValue('Untitled');
  await titleEditor.fill(title);
  await page.getByRole('textbox', { name: 'Note body, Markdown' }).fill(body);
  await expect(page.getByRole('button', { name: 'Start dictation' })).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.getByRole('status')).toHaveText('Saved');
  // Router refresh after autosave updates the tree. This proves the next
  // navigation leaves a persisted Note, not a client-only draft.
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
}

test('a Markdown Note persists across navigation instead of living only in the editor', async ({
  workspace,
}) => {
  const { page } = workspace;
  const title = 'Launch decisions';
  const body = '## Launch\n\n- Keep the scope small.\n- Ship the daily loop first.';

  await goTo(page, '/notes');
  await createRootNote(page, title, body);

  await goTo(page, '/');
  await goTo(page, '/notes');

  await page.getByRole('button', { name: title, exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(title);
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(body);
});

test('the Markdown editor keeps fast source-native formatting and list continuation', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/notes');
  await createRootNote(page, 'Source editing', 'Plan');

  const editor = page.getByRole('textbox', { name: 'Note body, Markdown' });
  await editor.focus();
  await editor.press('ControlOrMeta+A');
  await editor.press('ControlOrMeta+B');
  await expect(editor).toHaveValue('**Plan**');

  await editor.fill('- First');
  await editor.press('End');
  await editor.press('Enter');
  await expect(editor).toHaveValue('- First\n- ');

  await editor.press('Enter');
  await expect(editor).toHaveValue('- First\n');
});

test('the rich editor writes back to the same portable Markdown Note', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/notes');
  await createRootNote(page, 'Rich editing', 'Plan');

  await page.getByRole('button', { name: 'Rich', exact: true }).click();
  const richEditor = page.getByRole('textbox', { name: 'Note body, rich text' });
  await expect(richEditor).toBeEditable();
  await richEditor.click();
  await richEditor.press('ControlOrMeta+A');
  await richEditor.type('Better plan');
  await richEditor.press('ControlOrMeta+A');
  await page
    .getByRole('toolbar', { name: 'Markdown formatting' })
    .getByRole('button', { name: 'Bold' })
    .click();

  await page.getByRole('button', { name: 'Source' }).click();
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(
    '**Better plan**\n'
  );
});

test('a Note link becomes a navigable backlink from the related Note', async ({ workspace }) => {
  const { page } = workspace;
  const sourceTitle = 'Product direction';
  const targetTitle = 'Research evidence';

  await goTo(page, '/notes');
  await createRootNote(page, sourceTitle, 'The core workflow must work without AI.');

  await createRootNote(page, targetTitle, 'Evidence and open questions.');

  await page.getByRole('button', { name: sourceTitle, exact: true }).click();
  const noteSelector = page.getByRole('combobox', { name: 'Note to link' });
  await noteSelector.selectOption({ label: targetTitle });
  await page.getByRole('button', { name: 'Add link' }).click();

  await expect(page.getByRole('button', { name: `related ${targetTitle}` })).toBeVisible();
  await page.getByRole('button', { name: `related ${targetTitle}` }).click();

  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(targetTitle);
  const backlink = page.getByRole('button', { name: `backlink · related ${sourceTitle}` });
  await expect(backlink).toBeVisible();
  await backlink.click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(sourceTitle);
});

test('a supported attachment is retained in quarantine instead of becoming an unsafe download', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/notes');
  await createRootNote(page, 'Attachment evidence', 'Keep supporting material with the decision.');

  await page.getByLabel('Attach a file').setInputFiles({
    name: 'research.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Research\n\nSource material.'),
  });

  await expect(page.getByText('research.md', { exact: true })).toBeVisible();
  await expect(page.getByText('Security review pending', { exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove attachment research.md' }).click();
  await expect(page.getByText('research.md removed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore attachment research.md' }).click();
  await expect(page.getByText('research.md', { exact: true })).toBeVisible();
});
