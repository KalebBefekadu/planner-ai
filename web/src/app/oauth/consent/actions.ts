'use server';

import { redirect } from 'next/navigation';
import { mcpGrantOptions } from '@/lib/mcp/catalog';
import { createClient } from '@/lib/supabase/server';

function consentUrl(authorizationId: string, message: string) {
  const params = new URLSearchParams({ authorization_id: authorizationId, message });
  return `/oauth/consent?${params.toString()}`;
}

function authorizationId(formData: FormData) {
  const value = formData.get('authorizationId');
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,500}$/.test(value)) redirect('/');
  return value;
}

async function authorizationDetails(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) redirect(consentUrl(id, 'This authorization request is invalid or expired.'));
  return { supabase, details: data };
}

export async function approveMcpAuthorization(formData: FormData) {
  const id = authorizationId(formData);
  const { supabase, details } = await authorizationDetails(id);
  if ('redirect_url' in details) redirect(details.redirect_url);

  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.data?.currentLevel !== 'aal2') {
    redirect(consentUrl(id, 'Verify your session with TOTP before approving an AI connection.'));
  }

  const allowedIds = new Set<string>(mcpGrantOptions.map((grant) => grant.id));
  const operations = formData
    .getAll('operations')
    .filter((value): value is string => typeof value === 'string' && allowedIds.has(value));
  if (!operations.length) {
    redirect(consentUrl(id, 'Choose at least one Planner AI capability.'));
  }

  const { error: grantError } = await supabase.rpc('approve_mcp_oauth_grant', {
    p_oauth_client_id: details.client.id,
    p_client_name: details.client.name,
    p_allowed_operations: operations,
  });
  if (grantError) redirect(consentUrl(id, 'Planner AI could not save this capability grant.'));

  const { data, error } = await supabase.auth.oauth.approveAuthorization(id, {
    skipBrowserRedirect: true,
  });
  if (error || !data?.redirect_url) {
    redirect(consentUrl(id, 'The authorization provider could not complete this request.'));
  }
  redirect(data.redirect_url);
}

export async function denyMcpAuthorization(formData: FormData) {
  const id = authorizationId(formData);
  const { supabase, details } = await authorizationDetails(id);
  if ('redirect_url' in details) redirect(details.redirect_url);
  const { data, error } = await supabase.auth.oauth.denyAuthorization(id, {
    skipBrowserRedirect: true,
  });
  if (error || !data?.redirect_url) redirect('/settings/mcp');
  redirect(data.redirect_url);
}
