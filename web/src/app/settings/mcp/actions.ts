'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createMcpToken, hashMcpToken } from '@/lib/mcp/auth';
import { mcpGrantOptions } from '@/lib/mcp/catalog';
import { createClient } from '@/lib/supabase/server';

export type CreateMcpTokenState = { token?: string; error?: string };

const grantIds = new Set<string>(mcpGrantOptions.map((grant) => grant.id));
const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  durationDays: z.coerce.number().int().min(1).max(90),
  operations: z
    .array(z.string())
    .min(1)
    .max(50)
    .refine((operations) => operations.every((operation) => grantIds.has(operation))),
});

export async function createMcpTokenAction(
  _state: CreateMcpTokenState,
  formData: FormData
): Promise<CreateMcpTokenState> {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    return { error: 'MCP is not enabled for this Workspace yet.' };
  }
  const parsed = createSchema.safeParse({
    name: formData.get('name'),
    durationDays: formData.get('durationDays'),
    operations: formData.getAll('operations'),
  });
  if (!parsed.success) return { error: 'Choose a name, expiry, and at least one capability.' };

  const supabase = await createClient();
  const [userResult, assuranceResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (!userResult.data.user) return { error: 'Sign in again before creating a token.' };
  if (assuranceResult.data?.currentLevel !== 'aal2') {
    return { error: 'Verify this session with your authenticator first.' };
  }

  const token = createMcpToken(randomBytes(32));
  const expiresAt = new Date(Date.now() + parsed.data.durationDays * 86_400_000).toISOString();
  const { error } = await supabase.rpc('create_mcp_access_token', {
    p_token_hash: await hashMcpToken(token),
    p_name: parsed.data.name,
    p_allowed_operations: [...new Set(parsed.data.operations)],
    p_expires_at: expiresAt,
  });
  if (error) return { error: 'Planner AI could not create this token.' };
  revalidatePath('/settings/mcp');
  return { token };
}

export async function revokeMcpTokenAction(formData: FormData) {
  const tokenId = z.uuid().safeParse(formData.get('tokenId'));
  if (!tokenId.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('revoke_mcp_access_token', {
    p_token_id: tokenId.data,
  });
  if (!error) revalidatePath('/settings/mcp');
}

export async function revokeMcpOAuthGrantAction(formData: FormData) {
  const clientId = z.string().min(1).max(500).safeParse(formData.get('clientId'));
  if (!clientId.success) return;
  const supabase = await createClient();
  await supabase.rpc('revoke_mcp_oauth_grant', { p_oauth_client_id: clientId.data });
  await supabase.auth.oauth.revokeGrant({ clientId: clientId.data });
  revalidatePath('/settings/mcp');
}
