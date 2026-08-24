import { ExternalLink, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { mcpGrantOptions } from '@/lib/mcp/catalog';
import { createClient } from '@/lib/supabase/server';
import { approveMcpAuthorization, denyMcpAuthorization } from './actions';

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string; message?: string }>;
}) {
  const { authorization_id: authorizationId, message } = await searchParams;
  if (!authorizationId) redirect('/settings/mcp');
  const supabase = await createClient();
  const [{ data: userResult }, { data, error }, assurance] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.oauth.getAuthorizationDetails(authorizationId),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (!userResult.user) {
    redirect(
      `/login?returnTo=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`
    );
  }
  if (error || !data) {
    return (
      <div className="page oauth-consent-page">
        <section className="oauth-consent-panel">
          <h1>Authorization unavailable</h1>
          <p>This request is invalid, expired, or OAuth is not enabled for this project.</p>
          <Link className="btn-secondary" href="/settings/mcp">
            Back to AI connections
          </Link>
        </section>
      </div>
    );
  }
  if ('redirect_url' in data) redirect(data.redirect_url);

  const redirectHost = (() => {
    try {
      return new URL(data.redirect_uri).host;
    } catch {
      return 'registered client';
    }
  })();
  const hasAal2 = assurance.data?.currentLevel === 'aal2';

  return (
    <div className="page oauth-consent-page">
      <section className="oauth-consent-panel">
        <header>
          <span className="oauth-consent-icon">
            <ShieldCheck size={22} />
          </span>
          <div>
            <p className="eyebrow">AI connection request</p>
            <h1>Connect {data.client.name}</h1>
            <p>Choose exactly what this client can do in your private Planner AI workspace.</p>
          </div>
        </header>

        <div className="oauth-client-details">
          <div>
            <span>Client</span>
            <strong>{data.client.name}</strong>
          </div>
          <div>
            <span>Returns to</span>
            <strong>{redirectHost}</strong>
          </div>
          <div>
            <span>Identity scopes</span>
            <strong>{data.scope || 'None requested'}</strong>
          </div>
        </div>

        {message ? (
          <p className="status-message status-message-error" role="alert">
            {message}
          </p>
        ) : null}
        {!hasAal2 ? (
          <p className="status-message status-message-error" role="alert">
            TOTP verification is required for offline AI access.{' '}
            <Link href="/settings/security" target="_blank">
              Verify security <ExternalLink size={12} aria-hidden="true" />
            </Link>
          </p>
        ) : null}

        <form action={approveMcpAuthorization} className="oauth-consent-form">
          <input type="hidden" name="authorizationId" value={authorizationId} />
          <fieldset className="scope-grid">
            <legend>Planner AI capabilities</legend>
            {mcpGrantOptions.map((grant) => (
              <label className="scope-option" key={grant.id}>
                <input
                  type="checkbox"
                  name="operations"
                  value={grant.id}
                  defaultChecked={grant.id === 'workspace.snapshot.read.v1'}
                />
                <span>
                  <strong>{grant.id.replace(/\.v\d+$/, '').replaceAll('.', ' ')}</strong>
                  <small>{grant.summary}</small>
                </span>
                <span className={`risk-label risk-${grant.risk}`}>{grant.risk}</span>
              </label>
            ))}
          </fieldset>
          <div className="oauth-consent-actions">
            <button className="btn-primary" type="submit" disabled={!hasAal2}>
              Approve connection
            </button>
          </div>
        </form>
        <form action={denyMcpAuthorization} className="oauth-deny-form">
          <input type="hidden" name="authorizationId" value={authorizationId} />
          <button className="text-button text-button-danger" type="submit">
            Deny and return
          </button>
        </form>
      </section>
    </div>
  );
}
