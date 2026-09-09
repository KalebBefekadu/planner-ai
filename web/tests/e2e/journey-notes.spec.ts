import { readFileSync } from 'node:fs';

import { test, expect, goTo, waitForHydration } from './support/workspace';
import { currentTotp } from './support/totp';

// Journey 5 of the delivery rule: knowledge stays understandable after the
// moment it was written. Notes are not a disposable editor; they preserve
// Markdown, expose deliberate connections, and let a person travel either
// direction through those connections.

// A Note in the tree, addressed within the tree itself. A Note titled after one
// of the editor's own controls -- "Task list", say -- otherwise matches that
// control as well, and the test fails on the ambiguity rather than on anything
// about the Note.
function treeNote(page: import('@playwright/test').Page, title: string) {
  return page.getByRole('navigation', { name: 'Notes' }).getByRole('button', {
    name: title,
    exact: true,
  });
}

// Open a Note and wait until the editor is actually showing it. Clicking a tree
// item starts a navigation, so an assertion made straight afterwards can still
// be reading the Note that was open before.
async function openNote(page: import('@playwright/test').Page, title: string) {
  await treeNote(page, title).click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(title);
}

async function createRootNote(page: import('@playwright/test').Page, title: string, body: string) {
  // Waiting for a URL that merely has a note in it proves nothing when a Note
  // is already open: that pattern already matches, so the assertion passes
  // before the new Note exists and the editor is still showing the previous
  // one. Wait for the address to actually change.
  const before = page.url();
  await page.getByRole('button', { name: 'New root note' }).click();
  await expect(page).toHaveURL((url) => url.href !== before && /\/notes\?note=/.test(url.href));
  const titleEditor = page.getByRole('textbox', { name: 'Note title' });
  await expect(titleEditor).toHaveValue('Untitled');
  await titleEditor.fill(title);
  await page.getByRole('textbox', { name: 'Note body, Markdown' }).fill(body);
  await expect(page.getByRole('button', { name: 'Start dictation' })).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.getByRole('status')).toHaveText('Saved');
  // Router refresh after autosave updates the tree. This proves the next
  // navigation leaves a persisted Note, not a client-only draft.
  await expect(treeNote(page, title)).toBeVisible();
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

  await openNote(page, title);
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
  await openNote(page, 'Third decision');
  await expect(page.getByRole('button', { name: 'Move note down' })).toBeDisabled();
  await page.getByRole('button', { name: 'Move note up' }).click();
  await expect.poll(treeTitles).toEqual(['First decision', 'Third decision', 'Second decision']);

  // A move is a persisted Operation, not a client-side rearrangement.
  await goTo(page, '/');
  await goTo(page, '/notes');
  expect(await treeTitles()).toEqual(['First decision', 'Third decision', 'Second decision']);

  // The Note that reached the top can no longer rise, which is the same edge
  // condition from the other direction.
  await openNote(page, 'First decision');
  await expect(page.getByRole('button', { name: 'Move note up' })).toBeDisabled();
});

// Where a Note sits in the hierarchy was, like its order, an agent-only
// decision: note.move.v1 could reparent a Note through the assistant or MCP,
// but nothing in the interface could. Indent and outdent are used rather than
// dragging, so the hierarchy stays reachable from a keyboard.
test('a Note can be moved under and back out of another Note from the interface', async ({
  workspace,
}) => {
  const { page } = workspace;

  await goTo(page, '/notes');
  await createRootNote(page, 'Parent decision', 'The material this belongs under.');
  await createRootNote(page, 'Moving decision', 'This one changes level.');
  await createRootNote(page, 'Later decision', 'This one stays put.');

  // Depth is read from the nesting itself rather than from indentation. A
  // padding measurement would only describe how the tree looks on one screen
  // width, and the hierarchy is meant to be real structure.
  const treeShape = () =>
    page.locator('.note-tree .note-tree-item').evaluateAll((items) =>
      items.map((item) => {
        let depth = -1;
        for (let node = item.parentElement; node; node = node.parentElement) {
          if (node.classList.contains('note-tree-level')) depth += 1;
        }
        return { title: item.querySelector('span')?.textContent ?? '', depth };
      })
    );

  expect(await treeShape()).toEqual([
    { title: 'Parent decision', depth: 0 },
    { title: 'Moving decision', depth: 0 },
    { title: 'Later decision', depth: 0 },
  ]);

  // The first Note at a level has nothing above it to go under, and a root Note
  // has no parent to leave. Both are offered as unavailable.
  await openNote(page, 'Parent decision');
  await expect(page.getByRole('button', { name: 'Make child of the note above' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move note out of its parent' })).toBeDisabled();

  await openNote(page, 'Moving decision');
  await page.getByRole('button', { name: 'Make child of the note above' }).click();
  await expect.poll(treeShape).toEqual([
    { title: 'Parent decision', depth: 0 },
    { title: 'Moving decision', depth: 1 },
    { title: 'Later decision', depth: 0 },
  ]);

  // Reparenting is a persisted Operation, not a client-side rearrangement.
  await goTo(page, '/');
  await goTo(page, '/notes');
  expect(await treeShape()).toEqual([
    { title: 'Parent decision', depth: 0 },
    { title: 'Moving decision', depth: 1 },
    { title: 'Later decision', depth: 0 },
  ]);

  // Leaving a parent must land the Note directly after it, beside the material
  // it came from, rather than at the end of the level.
  await openNote(page, 'Moving decision');
  await page.getByRole('button', { name: 'Move note out of its parent' }).click();
  await expect.poll(treeShape).toEqual([
    { title: 'Parent decision', depth: 0 },
    { title: 'Moving decision', depth: 0 },
    { title: 'Later decision', depth: 0 },
  ]);
});

// Indent and outdent reach the Note above and the grandparent. Filing reaches
// anywhere else the hierarchy allows, which is what moving a Note into a
// different branch actually requires.
test('a Note can be filed under a Note in another branch, and never under itself', async ({
  workspace,
}) => {
  const { page } = workspace;

  await goTo(page, '/notes');
  await createRootNote(page, 'Research', 'Where findings are kept.');
  await createRootNote(page, 'Loose finding', 'This belongs under Research.');

  const treeShape = () =>
    page.locator('.note-tree .note-tree-item').evaluateAll((items) =>
      items.map((item) => {
        let depth = -1;
        for (let node = item.parentElement; node; node = node.parentElement) {
          if (node.classList.contains('note-tree-level')) depth += 1;
        }
        return { title: item.querySelector('span')?.textContent ?? '', depth };
      })
    );

  await openNote(page, 'Loose finding');
  await expect(page.getByText('Filed at the top level')).toBeVisible();
  await page.getByLabel('File this Note under').selectOption({ label: 'Research' });
  await page.getByRole('button', { name: 'Move', exact: true }).click();

  await expect.poll(treeShape).toEqual([
    { title: 'Research', depth: 0 },
    { title: 'Loose finding', depth: 1 },
  ]);
  await expect(page.getByText('Filed under Research')).toBeVisible();

  // Filing a Note under its own descendant would take that branch out of the
  // tree, so the destination is never offered in the first place.
  await openNote(page, 'Research');
  const destinations = page.getByLabel('File this Note under');
  await expect(destinations).toBeVisible();
  expect(await destinations.locator('option').allInnerTexts()).toEqual(['Choose a place']);

  // The filing persists, and a Note can be sent back to the top level.
  await goTo(page, '/');
  await goTo(page, '/notes');
  await openNote(page, 'Loose finding');
  await page.getByLabel('File this Note under').selectOption({ label: 'Top level' });
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect.poll(treeShape).toEqual([
    { title: 'Research', depth: 0 },
    { title: 'Loose finding', depth: 0 },
  ]);
});

// The delivery rule requires that failure preserves what a person typed. A
// stale editor is the ordinary way that happens: the same Note open in two
// places, or one left open while the other was used.
test('a Note edited in two places reports the clash without losing what was typed', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/notes');
  await createRootNote(page, 'Contested decision', 'The original wording.');
  const noteUrl = page.url();

  // A second view of the same Note, holding the version it loaded with.
  const stale = await page.context().newPage();
  await stale.goto(noteUrl);
  await waitForHydration(stale);
  await expect(stale.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'Contested decision'
  );

  await page.getByRole('textbox', { name: 'Note body, Markdown' }).fill('The newer wording.');
  await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 15_000 });

  const losing = 'Work done in the stale view that must not vanish.';
  await stale.getByRole('textbox', { name: 'Note body, Markdown' }).fill(losing);

  // The clash is reported plainly rather than being retried into silence.
  await expect(stale.getByRole('status')).toHaveText('Not saved', { timeout: 15_000 });
  // Scoped past the router's own live region, which is also an alert.
  await expect(stale.getByRole('alert').filter({ hasText: 'changed elsewhere' })).toContainText(
    'This item changed elsewhere. Refresh and try again.'
  );

  // The words are still in the editor, so the person can copy them somewhere
  // safe. Losing them is what makes a conflict a data-loss bug rather than an
  // inconvenience.
  await expect(stale.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(losing);

  // The Note that did save is unharmed, so the refused write changed nothing.
  await stale.close();
  await goTo(page, '/notes');
  await openNote(page, 'Contested decision');
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(
    'The newer wording.'
  );
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
  // Completing an import refreshes the page, and in an empty workspace that
  // refresh changes which Note is active and remounts the workspace. The
  // report of what was just imported has to survive that, or a person importing
  // a vault never learns how much of it arrived.
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

test('a downloaded vault re-imports as an exact match and rebuilds Notes that are gone', async ({
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
  await expect(treeNote(page, childTitle)).toBeVisible();

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
    await openNote(page, title);
    await page.getByRole('button', { name: 'Archive note' }).click();
    await expect(treeNote(page, title)).toHaveCount(0);
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
  await expect(treeNote(page, parentTitle)).toBeVisible();
  await expect(treeNote(page, childTitle)).toBeVisible();
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

// WS-01: the writing has to be safe. Autosave waits 800ms after the last
// keystroke, and everything below is about what happens inside that window --
// the moment where the words exist in one place only.

test('typing and immediately opening another Note does not lose the last edit', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/notes');
  await createRootNote(page, 'First note', 'Original body.');
  await createRootNote(page, 'Second note', 'Somewhere else to go.');

  await treeNote(page, 'First note').click();
  const bodyEditor = page.getByRole('textbox', { name: 'Note body, Markdown' });
  await expect(bodyEditor).toHaveValue('Original body.');

  // Type and leave immediately. The debounce timer is cancelled by the
  // navigation, and cancelling the timer used to mean cancelling the edit.
  await bodyEditor.fill('Original body. Plus the sentence that must survive.');
  await treeNote(page, 'Second note').click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Second note');

  await treeNote(page, 'First note').click();
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(
    'Original body. Plus the sentence that must survive.'
  );

  // And it is on the server, not just in this tab.
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(
    'Original body. Plus the sentence that must survive.'
  );
});

test('an edit in flight is never written to the Note that was opened next', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/notes');
  await createRootNote(page, 'Source note', 'Belongs to the source.');
  await createRootNote(page, 'Destination note', 'Belongs to the destination.');

  await treeNote(page, 'Source note').click();
  // Wait for the Note to actually be open. Typing into an editor that is
  // still showing the previous Note puts the words in the wrong place before
  // autosave has had any say in it.
  const sourceBody = page.getByRole('textbox', { name: 'Note body, Markdown' });
  await expect(sourceBody).toHaveValue('Belongs to the source.');
  await sourceBody.fill('Belongs to the source. Edited just before leaving.');
  await treeNote(page, 'Destination note').click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Destination note');

  // The flushed save carries the Note it was typed into, not whichever Note
  // happens to be open when it lands.
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(
    'Belongs to the destination.'
  );
  await page.reload();
  await treeNote(page, 'Destination note').click();
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(
    'Belongs to the destination.'
  );
});

test('the editor says unsaved while it still is', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/notes');
  await createRootNote(page, 'Status note', 'Saved content.');

  await page.getByRole('textbox', { name: 'Note body, Markdown' }).fill('Saved content. More.');
  // Before this there were only three states, and a Note with unwritten
  // changes claimed "Saved" for the whole debounce window.
  await expect(page.getByRole('status')).toHaveText('Unsaved changes');
  await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 5_000 });
});

test('unsupported Markdown survives a round trip through the editor', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/notes');
  await createRootNote(page, 'Awkward syntax', 'Placeholder while the Note is created.');

  // A footnote, a table and an HTML comment: syntax the rich editor does not
  // model. Source editing must not quietly normalise it away.
  const awkward = [
    '# Heading',
    '',
    'Body with a footnote.[^1]',
    '',
    '[^1]: The footnote text.',
    '',
    '| Column | Other |',
    '| --- | --- |',
    '| a | b |',
    '',
    '<!-- a comment the editor does not understand -->',
  ].join('\n');
  await page.getByRole('textbox', { name: 'Note body, Markdown' }).fill(awkward);
  // Scoped to the save indicator: content outside the rich subset raises its
  // own status notice, so an unscoped status lookup is ambiguous here.
  await expect(page.locator('.save-state')).toHaveText('Saved', { timeout: 10_000 });

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(awkward);
});
