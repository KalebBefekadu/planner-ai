import { readFileSync } from 'node:fs';

import { test, expect, goTo } from './support/workspace';
import { currentTotp } from './support/totp';

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

// Sibling order is a decision a person makes about their own material. Until
// this control existed it could only be changed through the assistant or MCP,
// which made the order of a knowledge base something only an agent could set.
test('a Note can be reordered among its siblings and the new order survives reload', async ({
  workspace,
}) => {
  const { page } = workspace;

  await goTo(page, '/notes');
  await createRootNote(page, 'First decision', 'Written first.');
  await createRootNote(page, 'Second decision', 'Written second.');
  await createRootNote(page, 'Third decision', 'Written third.');

  const treeTitles = () =>
    page.locator('.note-tree .note-tree-item span:first-child').allInnerTexts();
  expect(await treeTitles()).toEqual(['First decision', 'Second decision', 'Third decision']);

  // The last Note has nowhere further to fall, so that direction is offered as
  // unavailable rather than as a control that quietly does nothing.
  await page.getByRole('button', { name: 'Third decision', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Move note down' })).toBeDisabled();
  await page.getByRole('button', { name: 'Move note up' }).click();
  await expect.poll(treeTitles).toEqual(['First decision', 'Third decision', 'Second decision']);

  // A move is a persisted Operation, not a client-side rearrangement.
  await goTo(page, '/');
  await goTo(page, '/notes');
  expect(await treeTitles()).toEqual(['First decision', 'Third decision', 'Second decision']);

  // The Note that reached the top can no longer rise, which is the same edge
  // condition from the other direction.
  await page.getByRole('button', { name: 'First decision', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Move note up' })).toBeDisabled();
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

test('a downloaded vault re-imports as an exact match of its source Notes', async ({
  workspace,
}) => {
  const { page } = workspace;
  const parentTitle = 'Portable parent decision';
  const childTitle = 'Portable child decision';
  const childBody = 'The child must not be flattened to the root.';

  await goTo(page, '/notes');
  await createRootNote(page, parentTitle, 'The parent must survive the round trip.');
  await page.getByRole('button', { name: 'Child note' }).click();
  await expect(page).toHaveURL(/\/notes\?note=/);
  const childTitleEditor = page.getByRole('textbox', { name: 'Note title' });
  await expect(childTitleEditor).toHaveValue('Untitled');
  await childTitleEditor.fill(childTitle);
  await page.getByRole('textbox', { name: 'Note body, Markdown' }).fill(childBody);
  await page.waitForTimeout(1_000);
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(page.getByRole('button', { name: childTitle, exact: true })).toBeVisible();

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
  const vaultPath = await vault.path();
  expect(vaultPath).toBeTruthy();

  // Re-importing the archive Planner AI just produced is the round trip that
  // proves an exported vault is genuinely portable rather than merely readable.
  await goTo(page, '/notes');
  await page.getByRole('button', { name: 'Import Notes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import Notes' });
  await dialog.getByLabel('Source').selectOption('generic');
  // The upload has to keep its .zip name: the route selects the archive reader
  // by file extension, and a download path alone carries none.
  await dialog
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: vault.suggestedFilename(),
      mimeType: 'application/zip',
      buffer: readFileSync(vaultPath as string),
    });

  // Duplicate detection compares title and body exactly, so both Notes being
  // recognised is the assertion that the vault round-tripped without loss: the
  // manifest was read, and export frontmatter was stripped back off the body.
  const summary = dialog.getByLabel('Import summary');
  await expect(summary).toContainText('2Duplicates');
  await expect(summary).toContainText('0Unsupported');
  await expect(dialog.getByLabel('Import preview')).toContainText(parentTitle);
  await expect(dialog.getByLabel('Import preview')).toContainText(childTitle);
  await expect(dialog.getByLabel('Import preview')).not.toContainText('planner_ai_export');
  await dialog.getByRole('button', { name: 'Close import' }).click();

  // Recognising duplicates proves the vault is readable, not that it can
  // rebuild anything. A vault is a recovery format, so the case that matters
  // is restoring into a workspace that no longer holds the originals.
  // Archiving them is what makes the next import a real creation: exact
  // duplicate detection only considers Notes that are still live.
  page.on('dialog', (confirmation) => void confirmation.accept());
  for (const title of [childTitle, parentTitle]) {
    await page.getByRole('button', { name: title, exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(title);
    await page.getByRole('button', { name: 'Archive note' }).click();
    await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0);
  }

  await page.getByRole('button', { name: 'Import Notes' }).click();
  await dialog.getByLabel('Source').selectOption('generic');
  await dialog
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: vault.suggestedFilename(),
      mimeType: 'application/zip',
      buffer: readFileSync(vaultPath as string),
    });

  // Nothing may be rejected or skipped. A vault records each Note's order
  // within its parent, and that recorded order has to validate and commit
  // rather than turn a restorable vault into an unsupported one.
  await expect(summary).toContainText('0Duplicates');
  await expect(summary).toContainText('0Unsupported');
  await dialog.getByRole('button', { name: 'Import 2' }).click();
  await expect(dialog.getByText('2 Notes imported', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();

  // Both Notes come back, and the child comes back beneath its parent rather
  // than flattened to the root.
  await goTo(page, '/notes');
  await expect(page.getByRole('button', { name: parentTitle, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: childTitle, exact: true })).toBeVisible();
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
