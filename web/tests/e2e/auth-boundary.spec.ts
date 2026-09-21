import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const mcpAppOrigin = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? '3100'}`;

test('anonymous users cannot see the workspace', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page).not.toHaveURL(/message=/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show entered value' })).toBeVisible();
  await expect(page.getByText('What is on your mind?')).toHaveCount(0);
});

test('readiness confirms the canonical application without exposing private data', async ({
  request,
}) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  await expect(response.json()).resolves.toEqual({ status: 'ok' });
});

test('the frontend preview is available without authentication', async ({ page }) => {
  await page.goto('/preview');
  await expect(page).toHaveURL(/\/preview$/);
  await expect(page.getByRole('heading', { name: 'Personal operating system' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();

  const openPage = async (name: string) => {
    const pageButton = page.getByRole('button', { name, exact: true });
    const menuButton = page.getByRole('button', { name: 'Open menu' });
    await expect(pageButton.or(menuButton)).toBeVisible();
    if (!(await pageButton.isVisible())) {
      await menuButton.click();
    }
    await expect(pageButton).toBeVisible();
    await pageButton.click();
  };

  await openPage('North star & values');
  await expect(page.getByRole('heading', { name: 'North star & values' })).toBeVisible();

  await openPage('Health reset');
  await expect(page.getByRole('heading', { name: 'Health reset' })).toBeVisible();
});

test('planner and settings use their own navigation surfaces', async ({ page }) => {
  await page.goto('/preview');
  await page
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByLabel('Planner', { exact: true })
    .click();
  // /preview is the fixture reference, not the product, and it still carries
  // the heading the real Today has stopped using. It is due for removal rather
  // than for being kept in step.
  await expect(page.getByRole('heading', { name: 'Make today count' })).toBeVisible();
  await expect(page.getByText('Personal workspace')).toHaveCount(0);

  const plannerNavigation = page.getByRole('complementary', { name: 'Planner navigation' });
  if (!(await plannerNavigation.isVisible())) {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
  await expect(plannerNavigation).toBeVisible();
  await plannerNavigation.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();

  const railSettings = page
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByLabel('Settings', { exact: true });
  if (await railSettings.isVisible()) {
    await railSettings.click();
  } else {
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page
      .getByRole('complementary', { name: 'Planner navigation' })
      .getByRole('button', { name: 'Settings', exact: true })
      .click();
  }
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  const settingsNavigation = page.getByRole('complementary', { name: 'Settings navigation' });
  if (!(await settingsNavigation.isVisible())) {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
  await expect(settingsNavigation).toBeVisible();
});

test('authentication screens expose complete recovery and invite flows', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Your plans, notes, and actions — connected.')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await page.getByLabel('Password').fill('visible password');
  await page.getByRole('button', { name: 'Show entered value' }).click();
  await expect(page.getByLabel('Password')).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Hide entered value' })).toBeVisible();
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();

  await page.goto('/signup');
  await expect(page.getByLabel('Invite code')).toBeVisible();
  await expect(page.getByLabel('Password')).toHaveAttribute('minlength', '12');
});

test('canonical users see the complete workspace navigation after login', async ({
  page,
}, testInfo) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  test.skip(
    !supabaseUrl?.startsWith('http://127.0.0.1:55321') || !serviceRoleKey,
    'This authenticated boundary test is restricted to the isolated local Supabase stack.'
  );

  const admin = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `canonical-nav-${testInfo.project.name}-${Date.now()}@planner-ai.test`;
  const password = 'Planner-local-navigation-test!9';
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(error).toBeNull();
  expect(data.user).not.toBeNull();

  try {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page).not.toHaveURL(/\/onboarding/);

    const experienceWorkspace = page.getByRole('link', { name: 'Workspace', exact: true }).last();
    if ((await experienceWorkspace.count()) === 0 || !(await experienceWorkspace.isVisible())) {
      await page.getByRole('button', { name: 'Open menu' }).click();
    }
    await expect(experienceWorkspace).toHaveCount(1);
    await page.keyboard.press('Control+K');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await expect(
      page.getByRole('searchbox', { name: 'Search commands and workspace' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close command palette' }).click();

    if (!(await experienceWorkspace.isVisible())) {
      await page.getByRole('button', { name: 'Open menu' }).click();
    }
    await experienceWorkspace.click();
    await expect(page).toHaveURL(/\/notes(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Notes' })).toBeVisible();

    const mobileDrawer = page.locator('.experience-mobile-drawer');
    if (await mobileDrawer.isVisible()) {
      await mobileDrawer.getByRole('link', { name: 'Planner', exact: true }).click();
    } else {
      await page.getByRole('link', { name: 'Planner', exact: true }).last().click();
    }
    await expect(page).toHaveURL(/\/planner(?:\?|$)/);
    await expect(
      page
        .getByRole('heading', { name: 'Your plan now', exact: true })
        .or(page.getByRole('heading', { name: 'Start with your vision', exact: true }))
    ).toBeVisible();
    const weeklyReview = page.getByRole('link', { name: 'Weekly review', exact: true });
    if (!(await weeklyReview.isVisible())) {
      await page.getByRole('button', { name: 'Open menu' }).click();
    }
    await expect(page.getByRole('link', { name: 'Calendar', exact: true })).toBeVisible();
    await expect(weeklyReview).toBeVisible();
    await expect(page.getByText('Personal workspace')).toHaveCount(0);

    await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible();
  } finally {
    if (data.user) await admin.auth.admin.deleteUser(data.user.id);
  }
});

test('anonymous AI requests fail with JSON instead of exposing a provider', async ({ request }) => {
  const response = await request.post('/api/socratic', {
    data: { visionText: 'A long enough private vision for this boundary test.' },
  });

  expect(response.status()).toBe(401);
  expect(response.headers()['content-type']).toContain('application/json');
  await expect(response.json()).resolves.toMatchObject({ code: 'authentication_required' });
});

/**
 * Every AI endpoint, found rather than listed.
 *
 * This used to be one test per endpoint, written when that endpoint was.
 * Which means a new AI route arrives with no boundary test and nothing says
 * so -- and two of them did exactly that. A route that reaches a paid provider
 * with no signed-in user is the one kind of hole worth finding by construction
 * rather than by remembering, so the list is derived from the source: anything
 * that calls `authorizeAiRequest` has to refuse an anonymous caller.
 */
function aiEndpoints(): string[] {
  const root = 'src/app/api';
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('route.ts'))
    .filter((entry) => readFileSync(join(root, entry), 'utf8').includes('authorizeAiRequest('))
    .map(
      (entry) =>
        `/api/${entry
          .replace(/\/route\.ts$/, '')
          .split('\\')
          .join('/')}`
    )
    .sort();
}

test('every AI endpoint refuses an anonymous caller', async ({ request }) => {
  const endpoints = aiEndpoints();
  /* If the search ever stops finding them, this test would pass over an empty
     list and guard nothing. */
  expect(endpoints.length, 'no AI endpoints were found to check').toBeGreaterThanOrEqual(8);

  for (const endpoint of endpoints) {
    const response = await request.post(endpoint, { data: {} });
    expect(response.status(), `${endpoint} let an anonymous caller in`).toBe(401);
    await expect(response.json(), `${endpoint} did not say why`).resolves.toMatchObject({
      code: 'authentication_required',
    });
  }
});

test('MCP publishes OAuth protected-resource metadata without authentication', async ({
  request,
}) => {
  const response = await request.get('/.well-known/oauth-protected-resource/api/mcp');
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    resource: `${mcpAppOrigin}/api/mcp`,
    resource_name: 'Planner AI MCP',
    bearer_methods_supported: ['header'],
  });
});

test('anonymous MCP requests fail before tools are disclosed', async ({ request }) => {
  const response = await request.post('/api/mcp', {
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });

  expect(response.status()).toBe(401);
  expect(response.headers()['content-type']).toContain('application/json');
  expect(response.headers()['www-authenticate']).toContain(
    `resource_metadata="${mcpAppOrigin}/.well-known/oauth-protected-resource/api/mcp"`
  );
  await expect(response.json()).resolves.toMatchObject({
    jsonrpc: '2.0',
    error: { message: 'A valid Planner AI MCP token is required.' },
  });
});

test('anonymous users cannot export Workspace data', async ({ request }) => {
  const response = await request.get('/api/export');
  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ error: 'Authentication required.' });
});

test('anonymous users cannot export a Markdown Notes vault', async ({ request }) => {
  const response = await request.get('/api/notes/export');
  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ error: 'Authentication required.' });
});

test('anonymous users cannot inspect or stage Notes imports', async ({ request }) => {
  const preview = await request.get('/api/note-import');
  expect(preview.status()).toBe(401);
  await expect(preview.json()).resolves.toMatchObject({ error: 'Authentication required.' });

  const upload = await request.post('/api/note-import', {
    multipart: {
      sourceType: 'generic',
      paths: '["private.md"]',
      files: { name: 'private.md', mimeType: 'text/markdown', buffer: Buffer.from('# Private') },
    },
  });
  expect(upload.status()).toBe(401);
  await expect(upload.json()).resolves.toMatchObject({ error: 'Authentication required.' });
});

test('notification delivery requires the private scheduler secret', async ({ request }) => {
  for (const method of ['get', 'post'] as const) {
    const response = await request[method]('/api/internal/notifications');
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'Not authorized.' });
  }
});

test('attachment purge requires the private scheduler secret', async ({ request }) => {
  for (const method of ['get', 'post'] as const) {
    const response = await request[method]('/api/internal/note-attachment-purge');
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'Not authorized.' });
  }
});

test('account deletion worker requires the private scheduler secret', async ({ request }) => {
  for (const method of ['get', 'post'] as const) {
    const response = await request[method]('/api/internal/account-deletions');
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'Not authorized.' });
  }
});
