import { readFileSync } from 'node:fs';

import AxeBuilder from '@axe-core/playwright';

import { test, expect, goTo, replaceFieldValue, waitForHydration } from './support/workspace';
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

// A search result or favourite carries where it is filed, so its accessible
// name is the title followed by the path. That is the point of the row: the
// name alone does not identify a Note, because titles are not unique.
function locatedNote(
  page: import('@playwright/test').Page,
  listName: string,
  title: string,
  ancestors: string[] = []
) {
  return page.getByRole('navigation', { name: listName }).getByRole('button', {
    name: [title, ...(ancestors.length ? [ancestors.join(' / ')] : [])].join(' '),
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
  // `.first()` because titles repeat: a workspace may hold two Notes called
  // 'Notes' filed under different projects. This line has to establish that
  // the Note reached the tree, not that its title is unique -- asserting
  // uniqueness made creating a second same-titled Note a strict-mode
  // violation inside the helper.
  await expect(treeNote(page, title).first()).toBeVisible();
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
  await page.getByRole('button', { name: 'Links', exact: true }).click();
  const noteSelector = page.getByRole('combobox', { name: 'Note to link' });
  await noteSelector.selectOption({ label: targetTitle });
  await page.getByRole('button', { name: 'Add link' }).click();

  await expect(page.getByRole('button', { name: `related ${targetTitle}` })).toBeVisible();
  await page.getByRole('button', { name: `related ${targetTitle}` }).click();

  // Following the link must land on the related Note with its connections still
  // on screen. The workspace is remounted per Note, so an inspector pane held
  // inside it reset to Properties on arrival and hid the backlink that was the
  // whole reason for the journey -- the reader had to rediscover the tab at
  // every hop.
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(targetTitle);
  const backlink = page.getByRole('button', { name: `backlink · related ${sourceTitle}` });
  await expect(backlink).toBeVisible();
  await backlink.click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(sourceTitle);
  await expect(page.getByRole('button', { name: `related ${targetTitle}` })).toBeVisible();
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

  await replaceFieldValue(
    page.getByRole('textbox', { name: 'Note body, Markdown' }),
    'The newer wording.'
  );
  await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 15_000 });

  const losing = 'Work done in the stale view that must not vanish.';
  await replaceFieldValue(stale.getByRole('textbox', { name: 'Note body, Markdown' }), losing);

  // The clash is reported plainly rather than being retried into silence.
  await expect(stale.getByRole('status')).toHaveText('Not saved', { timeout: 15_000 });
  /* What the clash says has changed, and the assertion follows the product
     rather than pinning the sentence the product stopped saying. The advice
     used to be "Refresh and try again", which is the one action that discards
     the words in the editor; the conflict panel now shows both versions and
     offers a choice. Scoped by name past the router's own live region, which
     is also an alert. */
  const clash = stale.getByRole('alert', { name: 'Version conflict' });
  await expect(clash).toContainText('This Note was saved somewhere else while you were writing.');
  await expect(clash.getByRole('button', { name: 'Keep what I wrote' })).toBeVisible();
  await expect(clash.getByRole('button', { name: 'Use the saved version' })).toBeVisible();

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

// WS-05: an attachment is only worth keeping if the person can get it back.
// Uploading is the easy half; the half that matters is that the bytes are
// still reachable later, and that removing one is a decision that can be taken
// back rather than a silent loss.

test('an uploaded attachment can be opened again after the page is reloaded', async ({
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

  // Reload before downloading. An attachment that is only reachable from the
  // state left behind by the upload is not really stored anywhere a person can
  // return to.
  await page.reload();
  await waitForHydration(page);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download attachment research.md' }).click();
  const file = await download;
  expect(readFileSync(await file.path(), 'utf8')).toBe('# Research\n\nSource material.');
});

test('a file whose contents do not match its declared type is refused rather than stored as usable', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/notes');
  await createRootNote(page, 'Disguised upload', 'A PDF that is not a PDF.');

  // The browser decides the declared type from the file extension, so a person
  // can hand the server anything under any label. The recorded state has to
  // reflect what the bytes actually are, not what the upload claimed.
  await page.getByLabel('Attach a file').setInputFiles({
    name: 'invoice.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('MZ this is not a PDF at all'),
  });

  await expect(page.getByText('invoice.pdf', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Not available: contents do not match a PDF', { exact: true })
  ).toBeVisible();
  // A refused file is never offered for download, because offering it would be
  // the one thing the quarantine gate exists to prevent.
  await expect(page.getByRole('button', { name: 'Download attachment invoice.pdf' })).toHaveCount(
    0
  );
});

test('a removed attachment is still recoverable after the page is reloaded', async ({
  workspace,
}) => {
  const { page } = workspace;
  await goTo(page, '/notes');
  await createRootNote(
    page,
    'Attachment recovery',
    'Removing a file is not the same as losing it.'
  );

  await page.getByLabel('Attach a file').setInputFiles({
    name: 'contract.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('The agreed terms.'),
  });
  await expect(page.getByText('contract.txt', { exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove attachment contract.txt' }).click();
  await expect(page.getByRole('button', { name: 'Restore attachment contract.txt' })).toBeVisible();

  // The undo used to live only in the tab that did the removal. A person who
  // reloaded, or came back the next day still inside the retention window, was
  // shown nothing at all -- the file was still there, but unreachable and
  // unmentioned.
  await page.reload();
  await waitForHydration(page);

  await page.getByRole('button', { name: 'Restore attachment contract.txt' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download attachment contract.txt' }).click();
  const file = await download;
  expect(readFileSync(await file.path(), 'utf8')).toBe('The agreed terms.');
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

// The Notes list draws the hierarchy from the roots downwards, which is right
// while browsing and wrong while searching: a match nested under a Note that
// does not itself match has no rendered ancestor to hang from, so it was
// filtered into the list and then never drawn. Searching for a phrase that only
// appears deep in a tree returned an apparently empty sidebar. Search has to be
// able to reach the material that is hardest to find by hand, which is exactly
// the material that is nested.
test('search finds a nested Note whose ancestors do not match', async ({ workspace }) => {
  const { page } = workspace;

  await goTo(page, '/notes');
  await createRootNote(page, 'Quarterly container', 'Nothing distinctive here.');
  await createRootNote(page, 'Buried finding', 'The onboarding funnel leaks at verification.');

  // Put the second Note underneath the first so the match is a child of a
  // Note that the query will not match.
  await openNote(page, 'Buried finding');
  await page.getByRole('button', { name: 'Make child of the note above' }).click();
  /* Wait for the move to have actually landed, rather than for something that
     was already true. The previous assertion here was that the Note was visible
     in the tree -- which it was before the click as well, so it passed instantly
     against the pre-move hierarchy and let the search run against a tree that
     had not changed yet.

     The tree itself cannot serve as the signal: an ancestor path is rendered
     only for search results, so a filed Note and a root one look identical
     there. The editor breadcrumb is the surface that does change, and the Note
     is already open, so it is both the honest evidence and the one a person
     would actually look at to confirm where their page went. */
  await expect(page.getByRole('navigation', { name: 'Note location' })).toContainText(
    'Quarterly container'
  );

  const search = page.getByRole('textbox', { name: 'Search notes' });
  await search.fill('verification');
  await search.press('Enter');

  await expect(locatedNote(page, 'Notes', 'Buried finding', ['Quarterly container'])).toBeVisible();
  await expect(treeNote(page, 'Quarterly container')).toHaveCount(0);

  // Opening a result keeps the search in place, so a list of results stays a
  // list rather than collapsing back to the whole tree on the first click.
  await locatedNote(page, 'Notes', 'Buried finding', ['Quarterly container']).click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Buried finding');
  await expect(search).toHaveValue('verification');

  // A query that matches nothing has to say so. An empty tree that looks the
  // same as a workspace with no Notes at all reads as data loss.
  await search.fill('nothingmatchesthisquery');
  await search.press('Enter');
  await expect(page.getByText('No Notes match this search.')).toBeVisible();
});

// An explicit acceptance criterion of #123: a result has to identify the Note it
// will open. Titles repeat -- "Notes" under two different projects is the normal
// case, not a contrived one -- and results are drawn flat, away from the
// hierarchy that would otherwise tell them apart. Two identical buttons make
// choosing the right page guesswork, and the cost of guessing wrong is writing
// into the wrong page.
test('two Notes with the same title are told apart by where they are filed', async ({
  workspace,
}) => {
  const { page } = workspace;

  await goTo(page, '/notes');
  await createRootNote(page, 'Orion', 'The first project.');
  await createRootNote(page, 'Notes', 'Retrieval rewrite decisions.');
  // Creating a Note leaves it open, so the Note to file is already the selected
  // one. Reopening it by title cannot work here: once the first 'Notes' is
  // filed under Orion the tree holds two buttons with that name, which is the
  // very ambiguity this journey exists to expose.
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Notes');
  await page.getByRole('button', { name: 'Make child of the note above' }).click();
  await expect(treeNote(page, 'Notes')).toBeVisible();

  await createRootNote(page, 'Vega', 'The second project.');
  await createRootNote(page, 'Notes', 'Retrieval rewrite decisions.');
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Notes');
  await page.getByRole('button', { name: 'Make child of the note above' }).click();

  const search = page.getByRole('textbox', { name: 'Search notes' });
  await search.fill('retrieval');
  await search.press('Enter');

  // Both matches are listed, and each one names the project it belongs to.
  await expect(locatedNote(page, 'Notes', 'Notes', ['Orion'])).toBeVisible();
  await expect(locatedNote(page, 'Notes', 'Notes', ['Vega'])).toBeVisible();

  // Choosing by path opens that Note and not its namesake, which is the whole
  // reason the path is shown.
  await locatedNote(page, 'Notes', 'Notes', ['Vega']).click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Notes');
  await expect(page.getByRole('navigation', { name: 'Note location' })).toContainText('Vega');
});

// The mechanism behind #213, pinned on its own so the journey above is not the
// only thing standing between a regression and a silently lost move.
//
// Searching submits a form, which is a document load, and a document load
// aborts every request still in flight. A move started a moment earlier never
// reached the server: the Note stayed at root and nothing said so. Under load
// that swallowed the move about half the time.
test('a move survives a search started before it has finished', async ({ workspace }) => {
  const { page } = workspace;

  await goTo(page, '/notes');
  await createRootNote(page, 'Retention policy', 'The project.');
  await createRootNote(page, 'Retention decisions', 'Retrieval rewrite decisions.');

  // No wait between the move and the search: that gap is the whole defect.
  await page.getByRole('button', { name: 'Make child of the note above' }).click();
  const search = page.getByRole('textbox', { name: 'Search notes' });
  await search.fill('retrieval');
  await search.press('Enter');

  // The result names where the Note is filed, so this asserts the move landed
  // rather than merely that the Note still exists.
  await expect(
    locatedNote(page, 'Notes', 'Retention decisions', ['Retention policy'])
  ).toBeVisible();
});

// Favourites are the pages someone returns to daily. Held in the page they
// would be lost on the next reload and absent on every other device, so this
// test is about the mark surviving the round trip, not about the star lighting
// up.
test('a favourite Note stays reachable without the tree and survives reload', async ({
  workspace,
}) => {
  const { page } = workspace;

  await goTo(page, '/notes');
  await createRootNote(page, 'Standing agenda', 'The page opened every morning.');
  await createRootNote(page, 'Buried context', 'Filed away and rarely opened.');

  // Nothing is a favourite until someone says so, so the list is not offered.
  await expect(page.getByRole('navigation', { name: 'Favorite notes' })).toHaveCount(0);

  await openNote(page, 'Standing agenda');
  await page.getByRole('button', { name: 'Add to favorites' }).click();

  const favorites = page.getByRole('navigation', { name: 'Favorite notes' });
  await expect(favorites.getByRole('button', { name: 'Standing agenda' })).toBeVisible();
  await expect(favorites.getByRole('button', { name: 'Buried context' })).toHaveCount(0);

  // The mark is a persisted Operation, not a client-side flag.
  await goTo(page, '/');
  await goTo(page, '/notes');
  await expect(favorites.getByRole('button', { name: 'Standing agenda' })).toBeVisible();

  // A favourite is reachable while a search has narrowed the tree to something
  // else entirely -- which is exactly when someone needs a way back.
  const search = page.getByRole('textbox', { name: 'Search notes' });
  await search.fill('buried');
  await search.press('Enter');
  await expect(treeNote(page, 'Standing agenda')).toHaveCount(0);
  await expect(favorites.getByRole('button', { name: 'Standing agenda' })).toBeVisible();
  await favorites.getByRole('button', { name: 'Standing agenda' }).click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Standing agenda');

  // And taking a favourite back has to stick just as firmly as marking it.
  await page.getByRole('button', { name: 'Remove from favorites' }).click();
  await expect(page.getByRole('navigation', { name: 'Favorite notes' })).toHaveCount(0);
  await goTo(page, '/');
  await goTo(page, '/notes');
  await expect(page.getByRole('navigation', { name: 'Favorite notes' })).toHaveCount(0);
});

/* Opening the workspace must not cost the whole vault.
 *
 * The sidebar shows titles and structure. It used to be built from
 * `select('*')`, so every Note's full Markdown crossed the wire on every
 * navigation to draw text nobody was looking at -- and the cost of opening the
 * workspace grew with everything ever written in it, which is exactly backwards
 * for a product meant to hold years of notes.
 *
 * Asserted on the delivered payload rather than on the query, because the query
 * is an implementation detail and the bytes are the thing a person waits for. */
test('opening a Note does not send every other Note along with it', async ({ workspace }) => {
  const { page } = workspace;

  await goTo(page, '/notes');
  const otherBody = 'Sequestered paragraph that belongs to a Note nobody opened.';
  await createRootNote(page, 'Unopened elsewhere', otherBody);

  const openBody = 'The paragraph a person is actually reading right now.';
  await createRootNote(page, 'The open one', openBody);
  await openNote(page, 'The open one');

  const payload = await page.evaluate(async () => {
    const response = await fetch(window.location.href, { cache: 'no-store' });
    return response.text();
  });

  // The Note being read arrives with its text, because that is the page.
  expect(payload).toContain(openBody);
  // Both titles arrive, because the tree is a list of titles.
  expect(payload).toContain('Unopened elsewhere');
  // The other Note's text does not, because nothing is showing it.
  expect(payload).not.toContain(otherBody);
});

/* A hierarchy deeper than the ones every other test builds.
 *
 * WS-02 asks for create, rename, move, reorder, archive, restore and
 * breadcrumbs verified "across deep trees". Every journey here works two levels
 * down, which is where a bug that only appears at depth would not be. Depth is
 * where the interesting failures live: an ancestor chain walked one level at a
 * time, a breadcrumb that renders only the immediate parent, a move that
 * reparents against a stale tree, a restore that returns a Note to a parent
 * that is no longer there. */
test('a deeply filed Note keeps its whole ancestry through moving, archiving and restoring', async ({
  workspace,
}) => {
  const { page } = workspace;
  const depth = 5;
  const titles = ['Level one', 'Level two', 'Level three', 'Level four', 'Level five'];

  await goTo(page, '/notes');
  for (const title of titles) {
    await createRootNote(page, title, `Body of ${title}.`);
  }

  /* Indent files a Note under its previous *sibling*, so building a chain takes
     one press per level rather than one per Note. Once "Level two" sits under
     "Level one", the Note before "Level three" at the root is "Level one" --
     pressing once puts it there, and pressing again moves it alongside and then
     under "Level two". Stepping down a level at a time is what a person does,
     and it exercises indenting a Note that already has ancestors, which a
     single press never would. */
  for (let index = 1; index < depth; index += 1) {
    await openNote(page, titles[index]);
    for (let step = 1; step <= index; step += 1) {
      await page.getByRole('button', { name: 'Make child of the note above' }).click();
      await expect(page.getByRole('navigation', { name: 'Note location' })).toContainText(
        titles[step - 1]
      );
    }
  }

  // The breadcrumb is the whole ancestry, not just the parent -- which is the
  // difference between knowing where you are and knowing who your parent is.
  const breadcrumb = page.getByRole('navigation', { name: 'Note location' });
  await openNote(page, 'Level five');
  for (const ancestor of titles.slice(0, depth - 1)) {
    await expect(breadcrumb).toContainText(ancestor);
  }

  // A search matching only the deepest Note still has to say where it lives,
  // which means every ancestor has to come back with it.
  const search = page.getByRole('textbox', { name: 'Search notes' });
  await search.fill('Level five');
  await search.press('Enter');
  await expect(locatedNote(page, 'Notes', 'Level five', titles.slice(0, depth - 1))).toBeVisible();
  await search.fill('');
  await search.press('Enter');

  // Moving out of the deepest parent lifts exactly one level, not to the root.
  await openNote(page, 'Level five');
  await page.getByRole('button', { name: 'Move note out of its parent' }).click();
  await expect(breadcrumb).toContainText('Level three');
  await expect(breadcrumb).not.toContainText('Level four');

  // Archiving a deep Note and restoring it must return it to where it was,
  // rather than to the root because the ancestry was too expensive to keep.
  /* Archiving asks first, and Playwright dismisses a native dialog unless told
     otherwise -- so without this the click is accepted, the confirm is
     declined, and the assertion fails on a Note that was never archived. */
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Archive note' }).click();
  await expect(treeNote(page, 'Level five')).toHaveCount(0);

  /* Restoring is asserted in supabase/tests/note_archive_undo_depth.sql rather
     than here. Undo for an archived Note is a receipt in Activity, and picking
     the right receipt out of a list built by a long test is a fragile way to
     ask a question that the database answers exactly: does undo return the Note
     to the parent it had, five levels down, or to the root. */
});

/* Setting how a page looks.
 *
 * WS-03 asks for the icon and cover as authorized metadata outside the Markdown,
 * with accessible controls. The route-walking axe sweep never reaches these:
 * they are a panel behind a button, not a page, so the scan happens here with
 * the controls actually open.
 *
 * Persistence across a reload is the other half. Appearance lives beside the
 * document rather than inside it, which is exactly the arrangement where a
 * choice can appear to be taken and never be written.
 *
 * Deliberately one change, not a sequence. Each appearance change is a
 * versioned Operation against the Note's current version, so driving several in
 * a row is a test about write sequencing wearing the clothes of a test about
 * appearance -- and it fails for reasons that have nothing to do with what is
 * being asserted here. The cover and its position are covered at the database
 * layer in note_appearance.sql and note_vault_import_appearance.sql; their
 * browser coverage is tracked separately rather than bolted on here. */
test('a page icon is stored beside the Markdown and survives a reload', async ({ workspace }) => {
  const { page } = workspace;

  await goTo(page, '/notes');
  await createRootNote(page, 'Dressed up', 'A page worth looking at.');

  await page.getByRole('button', { name: 'Add a page icon' }).click();
  await page.getByRole('textbox', { name: 'Page icon' }).fill('\u{1F304}');

  /* Scanned with the panel open, because a closed panel exercises neither the
     field nor its label, and this surface is only ever met by someone who went
     looking for it. */
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole('button', { name: 'Use icon' }).click();
  await expect(page.getByRole('button', { name: /Page icon/ })).toBeVisible();

  // Appearance is stored beside the Markdown, so the proof is a reload rather
  // than the control looking right.
  await goTo(page, '/');
  await goTo(page, '/notes');
  await openNote(page, 'Dressed up');
  await expect(page.getByRole('button', { name: /Page icon/ })).toBeVisible();

  // And the writing is untouched: an icon is not an edit to the document.
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(
    'A page worth looking at.'
  );
});

/* Choosing a cover.
 *
 * One appearance change per test, on purpose. Each change is a versioned
 * Operation against the Note's current version and the panel disables itself
 * while one is in flight, so a test that drives several in a row is really
 * asserting write sequencing -- and fails for reasons that have nothing to do
 * with covers. See #229 for how that went the first time. */
test('a cover can be chosen and is still there after a reload', async ({ workspace }) => {
  const { page } = workspace;

  await goTo(page, '/notes');
  await createRootNote(page, 'Covered', 'A page with a picture.');

  await page.getByRole('button', { name: 'Add cover' }).click();
  await page.getByRole('radio', { name: 'Still water' }).check();

  /* "Change cover" only exists once a cover is rendered, so it is the evidence
     the choice was applied rather than merely clicked. */
  await expect(page.getByRole('button', { name: 'Change cover' })).toBeVisible();

  await goTo(page, '/');
  await goTo(page, '/notes');
  await openNote(page, 'Covered');
  await expect(page.getByRole('button', { name: 'Change cover' })).toBeVisible();

  // A cover is not an edit to the writing.
  await expect(page.getByRole('textbox', { name: 'Note body, Markdown' })).toHaveValue(
    'A page with a picture.'
  );
});

/* Moving the cover, from the keyboard.
 *
 * The range input is deliberately the control rather than a drag handle on the
 * image: dragging is unreachable without a pointer, and a range announces its
 * value. That only matters if it actually works from a keyboard, which is what
 * this asserts -- arrow keys, then blur, because the value is committed when
 * the interaction ends rather than on every intermediate step. */
test('the cover position can be set from the keyboard and is remembered', async ({ workspace }) => {
  const { page } = workspace;

  await goTo(page, '/notes');
  await createRootNote(page, 'Positioned', 'A page whose picture sits high.');

  await page.getByRole('button', { name: 'Add cover' }).click();
  await page.getByRole('radio', { name: 'Open field' }).check();
  await expect(page.getByRole('button', { name: 'Change cover' })).toBeVisible();

  /* The panel closes itself once the saved appearance arrives back from the
     server: the component notices the stored values have changed and resets to
     a closed state. So the sequence is choose, wait for it to close, reopen --
     reaching for the slider before the close leaves the test holding an element
     that is about to be unmounted, which reads as a stuck disabled control
     rather than as a panel doing what it is supposed to do. */
  const position = page.getByRole('slider', { name: /Cover position/ });
  await expect(position).toHaveCount(0);

  await page.getByRole('button', { name: 'Change cover' }).click();
  await expect(position).toBeEnabled();

  await position.focus();
  for (let step = 0; step < 5; step += 1) await position.press('ArrowLeft');
  await expect(page.getByText(/Cover position \(45% from the top\)/)).toBeVisible();
  // Committed when the interaction ends, so the blur is the save.
  await position.blur();

  await goTo(page, '/');
  await goTo(page, '/notes');
  await openNote(page, 'Positioned');
  await page.getByRole('button', { name: 'Change cover' }).click();
  await expect(page.getByText(/Cover position \(45% from the top\)/)).toBeVisible();
});

test('a long title is readable at the size the design sets it in', async ({ workspace }) => {
  const { page } = workspace;
  const long = 'A deliberately long personal operating system title that has to wrap';

  await goTo(page, '/notes');
  await createRootNote(page, long, 'Keep the scope small.');

  const title = page.getByRole('textbox', { name: 'Note title' });
  const measured = await title.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      family: style.fontFamily,
      size: Number.parseFloat(style.fontSize),
      scrollsSideways: element.scrollWidth > element.clientWidth + 1,
      clipsVertically: element.scrollHeight > element.clientHeight + 1,
    };
  });

  // The display face at the display size, the same treatment every other page
  // heading gets.
  expect(measured.family).toContain('Iowan Old Style');
  expect(measured.size).toBeGreaterThanOrEqual(32);

  // It wraps. As an input it could not, so a long title scrolled sideways out
  // of view -- barely noticeable at the old 20px, unusable at 40.
  expect(measured.scrollsSideways, 'the title scrolled sideways instead of wrapping').toBe(false);
  expect(measured.clipsVertically, 'the wrapped title was cut off').toBe(false);

  // Still one line of text: Enter commits instead of opening a second
  // paragraph, and the stored title keeps every word.
  await title.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(title).toHaveValue(long);

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(long);
});
