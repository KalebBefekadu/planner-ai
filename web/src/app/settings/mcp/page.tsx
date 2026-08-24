import { notFound } from 'next/navigation';
import { McpTokenManager, type McpTokenSummary } from '@/components/mcp-token-manager';
import { SettingsTabs } from '@/components/settings-tabs';
import { createClient } from '@/lib/supabase/server';
import { revokeMcpOAuthGrantAction, revokeMcpTokenAction } from './actions';

export default async function McpSettingsPage() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const supabase = await createClient();
  const [tokensResult, oauthGrantsResult, assuranceResult] = await Promise.all([
    supabase
      .from('mcp_access_tokens')
      .select('id,name,allowed_operations,expires_at,last_used_at,revoked_at,created_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('mcp_oauth_grants')
      .select(
        'id,oauth_client_id,client_name,allowed_operations,last_used_at,revoked_at,created_at'
      )
      .order('created_at', { ascending: false }),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (tokensResult.error || oauthGrantsResult.error) {
    throw new Error('Unable to load AI connections.');
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  return (
    <div className="page settings-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>AI connections</h1>
          <p className="lede">Give external AI clients precise, revocable access to Planner AI.</p>
        </div>
      </header>
      <SettingsTabs showCanonical />
      <McpTokenManager
        tokens={(tokensResult.data ?? []) as unknown as McpTokenSummary[]}
        oauthGrants={oauthGrantsResult.data ?? []}
        endpoint={`${appUrl.replace(/\/$/, '')}/api/mcp`}
        assuranceLevel={assuranceResult.data?.currentLevel === 'aal2' ? 'aal2' : 'aal1'}
        revokeAction={revokeMcpTokenAction}
        revokeOAuthAction={revokeMcpOAuthGrantAction}
      />
    </div>
  );
}
