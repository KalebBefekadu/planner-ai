import { expect, test } from '@playwright/test';

test('anonymous users cannot see the workspace', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page).not.toHaveURL(/message=/);
  await expect(page.getByRole('heading', { name: 'Continue planning' })).toBeVisible();
  await expect(page.getByText('What is on your mind?')).toHaveCount(0);
});

test('authentication screens expose complete recovery and invite flows', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await page.getByRole('link', { name: 'Forgot Password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset password' })).toBeVisible();

  await page.goto('/signup');
  await expect(page.getByLabel('Invite code')).toBeVisible();
  await expect(page.getByLabel('Password')).toHaveAttribute('minlength', '12');
});

test('anonymous AI requests fail with JSON instead of exposing a provider', async ({ request }) => {
  const response = await request.post('/api/socratic', {
    data: { visionText: 'A long enough private vision for this boundary test.' },
  });

  expect(response.status()).toBe(401);
  expect(response.headers()['content-type']).toContain('application/json');
  await expect(response.json()).resolves.toMatchObject({ code: 'authentication_required' });
});

test('anonymous users cannot analyze Captures into Proposals', async ({ request }) => {
  const response = await request.post('/api/capture-proposals', {
    data: { captureId: '10000000-0000-4000-8000-000000000001' },
  });

  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ code: 'authentication_required' });
});

test('anonymous users cannot generate Review Proposals', async ({ request }) => {
  const response = await request.post('/api/review-proposals', {
    data: { kind: 'weekly', startsOn: '2026-08-17', endsOn: '2026-08-23' },
  });

  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ code: 'authentication_required' });
});

test('MCP publishes OAuth protected-resource metadata without authentication', async ({
  request,
}) => {
  const response = await request.get('/.well-known/oauth-protected-resource/api/mcp');
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    resource: 'http://localhost:3000/api/mcp',
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
    'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"'
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
  const response = await request.post('/api/internal/notifications');
  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ error: 'Not authorized.' });
});
