import { scanTest as test, expect, goTo } from './support/workspace';

/* The preview inventory could only mark the command palette, the notifications
   screen and the settings screens `visual`: each surface exists and resembles
   the design reference, and nothing said what any of them actually did. These
   journeys make the behavioural claim the inventory was waiting for, against
   the real signed-in workspace rather than a fixture. */

test.describe('command palette', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'The palette shortcut is a desktop keyboard affordance.'
    );
  });

  test('opens on the keyboard shortcut and offers every product area', async ({ page }) => {
    await goTo(page, '/planner/today');

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    // Focus must start inside, or the first thing a keyboard user types goes
    // to the page behind the palette.
    await expect(palette.getByRole('searchbox')).toBeFocused();

    // Each result is named "<destination> <group>", so the group a person is
    // scanning for is part of the spoken name too.
    for (const destination of [
      'Today Home',
      'Calendar Planner',
      'Notes Workspace',
      'Account Settings',
      'Search workspace Search',
    ]) {
      await expect(palette.getByRole('link', { name: destination, exact: true })).toBeVisible();
    }
  });

  test('narrows the destinations as the query is typed, and says when none match', async ({
    page,
  }) => {
    await goTo(page, '/planner/today');
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });

    await palette.getByRole('searchbox').fill('calen');
    await expect(palette.getByRole('link', { name: 'Calendar Planner' })).toBeVisible();
    await expect(palette.getByRole('link', { name: 'Notes Workspace' })).toBeHidden();
    // The query is still offered as a workspace search, so a narrowed list is
    // never a dead end.
    await expect(palette.getByRole('button', { name: /Search for "calen"/ })).toBeVisible();

    await palette.getByRole('searchbox').fill('nothing matches this');
    await expect(palette.getByText('No destination matches that.')).toBeVisible();
    await expect(palette.getByRole('link')).toHaveCount(0);
  });

  test('a palette destination navigates, and Escape returns focus to the trigger', async ({
    page,
  }) => {
    await goTo(page, '/planner/today');
    const trigger = page.getByRole('button', { name: 'Search commands and workspace' });

    await trigger.click();
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.getByRole('searchbox').press('Escape');
    await expect(palette).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await palette.getByRole('link', { name: 'Calendar Planner' }).click();
    await expect(page).toHaveURL(/\/planner\/calendar$/);
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden();
  });

  test('an unmatched query still reaches workspace search with the text preserved', async ({
    page,
  }) => {
    await goTo(page, '/planner/today');
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.getByRole('searchbox').fill('invitation');
    await palette.getByRole('button', { name: /Search for "invitation"/ }).click();

    await expect(page).toHaveURL(/\/search\?q=invitation$/);
    await expect(page.getByRole('searchbox').first()).toHaveValue('invitation');
  });
});

test.describe('notifications', () => {
  test('is reachable from the rail and reports a real unread count', async ({ page }, testInfo) => {
    // The rail is the desktop frame; the mobile drawer is covered by
    // keyboard-navigation.spec.ts.
    test.skip(testInfo.project.name !== 'chromium', 'The rail is the desktop navigation frame.');
    await goTo(page, '/planner/today');

    // The rail badge is a coloured dot, so the count has to travel in the
    // accessible name as well (WCAG 1.4.1).
    const entry = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', {
      name: /^Notifications/,
    });
    await entry.click();

    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
    await expect(page.getByText(/^\d+ unread$/)).toBeVisible();
  });

  test('a freshly onboarded workspace shows the caught-up state, not a blank list', async ({
    page,
  }) => {
    await goTo(page, '/notifications');

    // A new account has no planning signals yet, so this is the state every
    // person meets first and the one a populated screenshot never shows.
    await expect(page.getByRole('heading', { name: 'You are caught up' })).toBeVisible();
    await expect(page.getByText('No planning signals need your attention.')).toBeVisible();

    // Refresh is the only control on an empty screen; it must stay usable
    // rather than being disabled into a dead end.
    const refresh = page.getByRole('button', { name: 'Refresh' });
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect(page.locator('.notification-center').getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'You are caught up' })).toBeVisible();
  });
});

test.describe('settings', () => {
  test('the account section reports the signed-in owner rather than a fixture', async ({
    page,
  }) => {
    await goTo(page, '/settings/account');

    // Scoped to main: the sidebar carries the same address, and on a phone that
    // copy is present but hidden, so an unscoped match asserts nothing.
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
    // The address is the account: if this showed anything but the signed-in
    // owner's, the section would be the preview mock rather than the product.
    await expect(main.getByText(/@planner-ai\.test$/).first()).toBeVisible();
    await expect(main.getByRole('term').filter({ hasText: 'Time zone' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Change time zone' })).toHaveAttribute(
      'href',
      '/settings/preferences'
    );
  });

  test('every settings section is reachable from the tab bar and keeps its tab marked', async ({
    page,
  }) => {
    await goTo(page, '/settings/account');
    const tabs = page.getByRole('navigation', { name: 'Settings sections' });

    for (const [label, url] of [
      ['Preferences', '/settings/preferences'],
      ['Security', '/settings/security'],
      ['Data', '/settings/data'],
    ] as const) {
      await tabs.getByRole('link', { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`${url}$`));
      await expect(tabs.getByRole('link', { name: label })).toHaveClass(/settings-tab-active/);
    }
  });

  test('each section says where the things it only reports are changed', async ({ page }) => {
    await goTo(page, '/settings/account');

    const related = page.getByRole('navigation', { name: 'Related settings' });
    await expect(related).toBeVisible();
    // The reason is the part the tab bar cannot carry, so it has to be on
    // screen and not only in the href.
    await expect(related.getByText('Export or delete everything you own')).toBeVisible();
    await related.getByRole('link', { name: /Security/ }).click();

    await expect(page).toHaveURL(/\/settings\/security$/);
    // The footer follows the section rather than being rendered once, so the
    // destination's own related links are different from the ones just left.
    await expect(
      page
        .getByRole('navigation', { name: 'Related settings' })
        .getByText('See the identity these authenticators protect')
    ).toBeVisible();
  });
});
