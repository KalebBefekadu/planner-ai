import { createHmac } from 'node:crypto';

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

function base32Decode(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = value.replace(/[=\s-]/g, '').toUpperCase();
  let bits = '';
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index === -1) throw new Error('The MFA enrollment returned an invalid TOTP secret.');
    bits += index.toString(2).padStart(5, '0');
  }
  return Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, index) =>
      Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)
    )
  );
}

// RFC 6238's default SHA-1 / 30-second / six-digit TOTP profile. Keeping it in
// the browser-journey spec lets us prove the real MFA boundary without adding a
// production dependency or a testing escape hatch.
function currentTotp(secret: string, now = Date.now()) {
  const counter = Math.floor(now / 30_000);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(value % 1_000_000).padStart(6, '0');
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

test('the rich editor preserves task completion as portable Markdown', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/notes');
  await createRootNote(page, 'Task list', '- [ ] Prepare the first invitation');

  await page.getByRole('button', { name: 'Rich', exact: true }).click();
  const task = page.getByRole('checkbox', {
    name: 'Task item checkbox for Prepare the first invitation',
  });
  await expect(task).not.toBeChecked();
  await task.check();
  await expect(task).toBeChecked();

  await page.getByRole('button', { name: 'Source' }).click();
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(
    '- [x] Prepare the first invitation\n\n'
  );
});

test('the rich editor inserts a table as portable GFM Markdown', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/notes');
  await createRootNote(page, 'Planning table', 'Start with the next decision.');

  await page.getByRole('button', { name: 'Rich', exact: true }).click();
  await page
    .getByRole('toolbar', { name: 'Markdown formatting' })
    .getByRole('button', { name: 'Table' })
    .click();
  await expect(page.locator('.rich-markdown-editor table')).toBeVisible();

  await page.getByRole('button', { name: 'Source' }).click();
  const source = page.getByRole('textbox', { name: 'Note body, Markdown' });
  await expect.poll(() => source.inputValue()).toMatch(/\|\s*-+\s*\|/);
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

test('a Markdown file is previewed before explicit vault import', async ({ workspace }) => {
  const { page } = workspace;
  const title = 'Imported planning brief';

  await goTo(page, '/notes');
  await page.getByRole('button', { name: 'Import Notes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import Notes' });
  await dialog.getByLabel('Source').selectOption('generic');
  await dialog
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: `${title}.md`,
      mimeType: 'text/markdown',
      buffer: Buffer.from(`# ${title}\n\nA portable planning decision.`),
    });

  await expect(dialog.getByLabel('Import preview')).toContainText(title);
  await dialog.getByRole('button', { name: 'Import 1' }).click();
  await expect(dialog.getByText('1 Notes imported', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(title);
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(
    /A portable planning decision\./
  );
});

test('a stepped-up session can download a portable Markdown Notes vault', async ({ workspace }) => {
  const { page } = workspace;
  const title = 'Exported planning decision';

  await goTo(page, '/notes');
  await createRootNote(page, title, 'This decision must remain portable.');

  await goTo(page, '/settings/security');
  await page.getByRole('button', { name: 'Add authenticator' }).click();
  const secret = await page.locator('#totp-secret').inputValue();
  await page.getByLabel('Verification code').fill(currentTotp(secret));
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByText('Primary authenticator', { exact: true })).toBeVisible();

  await goTo(page, '/settings/data');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Notes' }).click();
  const vault = await download;
  expect(vault.suggestedFilename()).toMatch(/^planner-ai-notes-\d{4}-\d{2}-\d{2}\.zip$/);
  expect(await vault.failure()).toBeNull();
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
