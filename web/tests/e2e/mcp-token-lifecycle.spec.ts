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
