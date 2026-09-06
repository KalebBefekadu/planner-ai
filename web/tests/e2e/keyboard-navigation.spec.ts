import { test, expect, goTo } from './support/workspace';

test('the mobile workspace menu is keyboard-operable and closes with Escape', async ({
  workspace,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile-chromium',
    'This journey verifies the mobile drawer.'
  );

  const { page } = workspace;
  await goTo(page, '/planner/calendar');

  const openMenu = page.getByRole('button', { name: 'Open menu' });
  await openMenu.focus();
  await page.keyboard.press('Enter');
  const drawer = page.locator('.experience-mobile-drawer');
  const plannerNavigation = drawer.getByLabel('Planner navigation');
  await expect(drawer.locator(':focus')).toBeVisible();
  await expect(plannerNavigation).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(plannerNavigation).toBeHidden();
  await expect(openMenu).toBeFocused();
});
