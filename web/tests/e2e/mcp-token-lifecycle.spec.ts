import { createClient } from '@supabase/supabase-js';

import { hashMcpToken } from '@/lib/mcp/auth';
import { expect, test, goTo } from './support/workspace';
import { currentTotp } from './support/totp';

test('an MFA-protected manual MCP token is scoped, usable, and immediately revocable', async ({
  workspace,
  request,
}) => {
  const { page } = workspace;

  await goTo(page, '/settings/security');
  await page.getByRole('button', { name: 'Add authenticator' }).click();
  const secret = await page.locator('#totp-secret').inputValue();
  await page.getByLabel('Verification code').fill(currentTotp(secret));
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByText('Primary authenticator', { exact: true })).toBeVisible();

  await goTo(page, '/settings/mcp');
  await page.getByLabel('Token name').fill('Local lifecycle check');
  await page.getByRole('button', { name: 'Create token' }).click();
  const token = await page.locator('.one-time-token code').textContent();
  expect(token).toMatch(/^planner_mcp_[A-Za-z0-9_-]{43}$/);

  const publicClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const directAuthentication = await publicClient.rpc('authenticate_mcp_token', {
    p_token_hash: await hashMcpToken(token!),
  });
  expect(directAuthentication.error).toBeNull();
  expect(directAuthentication.data).toHaveLength(1);

  const requestBody = { jsonrpc: '2.0', id: 'manual-token-lifecycle', method: 'tools/list' };
  const endpoint = await page.locator('.endpoint-section code').textContent();
  expect(endpoint).toMatch(/^http:\/\/localhost:\d+\/api\/mcp$/);
  const usable = await request.post(endpoint!, {
    headers: {
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    data: requestBody,
  });
  expect(usable.status()).toBe(200);
  const usableBody = await usable.json();
  expect(usableBody.result.tools).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'planner_workspace_snapshot' })])
  );

  await page.getByRole('button', { name: 'Revoke Local lifecycle check' }).click();
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible();

  const revoked = await request.post(endpoint!, {
    headers: {
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    data: requestBody,
  });
  expect(revoked.status()).toBe(401);
  await expect(revoked.json()).resolves.toMatchObject({
    error: { message: 'A valid Planner AI MCP token is required.' },
  });
});

// The roadmap exit gate for external access is not that a granted call works,
// it is that an ungranted one cannot. A host client asks the endpoint what it
// may do and then does it, so discovery is the security boundary a person
// actually experiences: anything listed there is something the assistant will
// eventually try. This walks the whole shape of the gate in one session --
// read, an approved reversible write that shows up in the interface, then
// revocation -- while asserting at every step that the capabilities the owner
// did not tick are neither advertised nor reachable.
test('an MCP token reaches only the capabilities its owner granted', async ({
  workspace,
  request,
}) => {
  const { page } = workspace;

  await goTo(page, '/settings/security');
  await page.getByRole('button', { name: 'Add authenticator' }).click();
  const secret = await page.locator('#totp-secret').inputValue();
  await page.getByLabel('Verification code').fill(currentTotp(secret));
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByText('Primary authenticator', { exact: true })).toBeVisible();

  await goTo(page, '/settings/mcp');
  await page.getByLabel('Token name').fill('Scoped capture client');
  // The snapshot read is ticked by default. Adding Capture and nothing else
  // makes every other write in the catalogue an ungranted capability, which is
  // what the negative assertions below are measuring against.
  await page.locator('input[name="operations"][value="capture.create.v1"]').check();
  await page.getByRole('button', { name: 'Create token' }).click();
  const token = await page.locator('.one-time-token code').textContent();
  const endpoint = await page.locator('.endpoint-section code').textContent();

  const call = (body: Record<string, unknown>) =>
    request.post(endpoint!, {
      headers: {
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      data: { jsonrpc: '2.0', ...body },
    });

  const discovery = await call({ id: 'scoped-discovery', method: 'tools/list' });
  expect(discovery.status()).toBe(200);
  const advertised = (await discovery.json()).result.tools.map(
    (tool: { name: string }) => tool.name
  );
  expect(new Set(advertised)).toEqual(
    new Set(['planner_workspace_snapshot', 'planner_capture_create_v1'])
  );

  // Naming an ungranted tool directly is the obvious thing a confused or
  // hostile client does once it has any valid credential at all.
  const ungranted = await call({
    id: 'scoped-ungranted',
    method: 'tools/call',
    params: { name: 'planner_goal_create_v1', arguments: { title: 'Should never exist' } },
  });
  const ungrantedBody = await ungranted.json();
  expect(ungrantedBody.error ?? ungrantedBody.result?.isError).toBeTruthy();

  const raw = `External assistant wrote this at ${Date.now()}`;
  const write = await call({
    id: 'scoped-write',
    method: 'tools/call',
    params: { name: 'planner_capture_create_v1', arguments: { rawText: raw, source: 'typed' } },
  });
  expect(write.status()).toBe(200);
  expect((await write.json()).result.isError).toBeFalsy();

  // A write that only exists in an API response has not happened as far as the
  // owner is concerned. It has to be in the interface they read every day.
  await goTo(page, '/inbox');
  await expect(page.getByLabel('Inbox history').getByText(raw, { exact: true })).toBeVisible();

  await goTo(page, '/settings/mcp');
  await page.getByRole('button', { name: 'Revoke Scoped capture client' }).click();
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible();

  const afterRevoke = await call({
    id: 'scoped-after-revoke',
    method: 'tools/call',
    params: { name: 'planner_capture_create_v1', arguments: { rawText: raw, source: 'typed' } },
  });
  expect(afterRevoke.status()).toBe(401);

  // Revocation must not quietly leave the goal it could not reach behind, and
  // must not undo the write the owner did approve while the token was live.
  await goTo(page, '/inbox');
  await expect(page.getByLabel('Inbox history').getByText(raw, { exact: true })).toBeVisible();
});
