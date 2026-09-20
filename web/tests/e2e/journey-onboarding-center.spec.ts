import { createClient } from '@supabase/supabase-js';
import { test, expect, localStackOrSkip, signIn } from './support/workspace';

const password = 'Planner-local-journey-test!9';

test('first-run setup asks for identity and rhythm, not life planning', async ({
  page,
}, testInfo) => {
  const local = localStackOrSkip();
  test.skip(local === null, 'Restricted to the isolated local Supabase stack.');
  const admin = createClient(local!.url, local!.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `onboarding-${testInfo.project.name}-${Date.now()}@planner-ai.test`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(created.error).toBeNull();

  try {
    await signIn(page, email, testInfo.project.use.baseURL, '/onboarding');
    await expect(
      page.getByRole('heading', { name: 'A one-minute setup, then you’re in.' })
    ).toBeVisible();
    await expect(page.getByLabel('What should we call you?')).toBeVisible();
    await expect(page.getByText('Choose an avatar color')).toBeVisible();
    await expect(page.getByText('Vision', { exact: true })).toHaveCount(0);
    await expect(page.getByText('First Action', { exact: true })).toHaveCount(0);

    await page.getByLabel('What should we call you?').fill('Ada Planner');
    await page.getByLabel('blue').check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Set your working week' })).toBeVisible();
    await page.getByRole('button', { name: 'Enter Planner AI' }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 60_000 });

    const user = await admin.auth.admin.getUserById(created.data.user!.id);
    expect(user.data.user?.user_metadata.display_name).toBe('Ada Planner');
    expect(user.data.user?.user_metadata.avatar_color).toBe('blue');
  } finally {
    await admin.auth.admin.deleteUser(created.data.user!.id);
  }
});

test('ordinary login enters the product without forcing unfinished onboarding', async ({
  page,
}, testInfo) => {
  const local = localStackOrSkip();
  test.skip(local === null, 'Restricted to the isolated local Supabase stack.');
  const admin = createClient(local!.url, local!.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `returning-${testInfo.project.name}-${Date.now()}@planner-ai.test`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(created.error).toBeNull();

  try {
    await signIn(page, email, testInfo.project.use.baseURL);
    await expect(page).toHaveURL(/\/$/, { timeout: 60_000 });
    await expect(page).not.toHaveURL(/\/onboarding/);
  } finally {
    await admin.auth.admin.deleteUser(created.data.user!.id);
  }
});

test('completed setup is not shown again', async ({ workspace }) => {
  await workspace.page.goto('/onboarding');
  await expect(workspace.page).toHaveURL(/\/$/, { timeout: 60_000 });
});
