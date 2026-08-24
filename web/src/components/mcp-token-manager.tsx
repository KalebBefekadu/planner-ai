'use client';

import { useActionState, useState } from 'react';
import { Check, Copy, KeyRound, Link2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { createMcpTokenAction, type CreateMcpTokenState } from '@/app/settings/mcp/actions';
import { mcpGrantOptions } from '@/lib/mcp/catalog';

const initialState: CreateMcpTokenState = {};

export type McpTokenSummary = {
  id: string;
  name: string;
  allowed_operations: string[];
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};
type OAuthGrantSummary = {
  id: string;
  oauth_client_id: string;
  client_name: string;
  allowed_operations: string[];
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export function McpTokenManager({
  tokens,
  oauthGrants,
  endpoint,
  assuranceLevel,
  revokeAction,
  revokeOAuthAction,
}: {
  tokens: McpTokenSummary[];
  oauthGrants: OAuthGrantSummary[];
  endpoint: string;
  assuranceLevel: 'aal1' | 'aal2';
  revokeAction: (formData: FormData) => Promise<void>;
  revokeOAuthAction: (formData: FormData) => Promise<void>;
}) {
  const [state, formAction, pending] = useActionState(createMcpTokenAction, initialState);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(value: string, target: string) {
    await navigator.clipboard.writeText(value);
    setCopied(target);
    window.setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="integration-layout">
      <section className="settings-section endpoint-section">
        <div>
          <h2>MCP endpoint</h2>
          <p>
            Use this URL in an MCP client. Standards-capable clients will open secure OAuth
            automatically.
          </p>
        </div>
        <div className="copy-field">
          <code>{endpoint}</code>
          <button
            className="icon-button"
            type="button"
            title="Copy MCP endpoint"
            aria-label="Copy MCP endpoint"
            onClick={() => void copy(endpoint, 'endpoint')}
          >
            {copied === 'endpoint' ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <ShieldCheck size={19} aria-hidden="true" />
            <div>
              <h2>OAuth connections</h2>
              <p>
                Recommended. Clients use PKCE and rotating refresh tokens; you approve capabilities
                during connection.
              </p>
            </div>
          </div>
        </div>
        <div className="token-list">
          {oauthGrants.length ? (
            oauthGrants.map((grant) => (
              <article className="token-row" key={grant.id}>
                <div>
                  <strong>{grant.client_name}</strong>
                  <span>{grant.allowed_operations.length} capabilities · OAuth 2.1</span>
                  <small>
                    {grant.revoked_at
                      ? 'Revoked'
                      : grant.last_used_at
                        ? `Last used ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(grant.last_used_at))}`
                        : 'Connected, not used yet'}
                  </small>
                </div>
                {!grant.revoked_at ? (
                  <form action={revokeOAuthAction}>
                    <input type="hidden" name="clientId" value={grant.oauth_client_id} />
                    <button
                      className="icon-button"
                      type="submit"
                      title="Revoke OAuth connection"
                      aria-label={`Revoke ${grant.client_name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </form>
                ) : null}
              </article>
            ))
          ) : (
            <div className="oauth-empty-connection">
              <Link2 size={17} aria-hidden="true" />
              <p>
                No OAuth clients are connected. Add the endpoint above to your AI client to begin.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <Plus size={19} aria-hidden="true" />
            <div>
              <h2>Create manual token</h2>
              <p>Use only for clients that cannot complete OAuth. Secrets are shown once.</p>
            </div>
          </div>
        </div>
        {assuranceLevel !== 'aal2' ? (
          <p className="status-message status-message-error" role="alert">
            Verify your session on the Security tab before creating an integration token.
          </p>
        ) : null}
        <form action={formAction} className="mcp-token-form">
          <div className="mcp-token-basics">
            <label>
              Token name
              <input className="input-field" name="name" maxLength={120} required />
            </label>
            <label>
              Expires in
              <select className="input-field" name="durationDays" defaultValue="30">
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
              </select>
            </label>
          </div>
          <fieldset className="scope-grid">
            <legend>Allowed capabilities</legend>
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
          {state.error ? (
            <p className="status-message status-message-error" role="alert">
              {state.error}
            </p>
          ) : null}
          <button
            className="btn-primary button-with-icon"
            type="submit"
            disabled={pending || assuranceLevel !== 'aal2'}
          >
            <KeyRound size={15} />
            {pending ? 'Creating...' : 'Create token'}
          </button>
        </form>
        {state.token ? (
          <div className="one-time-token" role="status">
            <div>
              <strong>Token created</strong>
              <span>This secret will disappear when you leave this page.</span>
            </div>
            <div className="copy-field">
              <code>{state.token}</code>
              <button
                className="icon-button"
                type="button"
                title="Copy token"
                aria-label="Copy token"
                onClick={() => void copy(state.token!, 'token')}
              >
                {copied === 'token' ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="settings-section">
        <div>
          <h2>Issued tokens</h2>
          <p>Only token metadata is stored here. Planner AI never stores the plaintext secret.</p>
        </div>
        <div className="token-list">
          {tokens.length ? (
            tokens.map((token) => (
              <article className="token-row" key={token.id}>
                <div>
                  <strong>{token.name}</strong>
                  <span>
                    {token.allowed_operations.length} capabilities · expires{' '}
                    {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(
                      new Date(token.expires_at)
                    )}
                  </span>
                  <small>
                    {token.revoked_at
                      ? 'Revoked'
                      : token.last_used_at
                        ? `Last used ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(token.last_used_at))}`
                        : 'Never used'}
                  </small>
                </div>
                {!token.revoked_at ? (
                  <form action={revokeAction}>
                    <input type="hidden" name="tokenId" value={token.id} />
                    <button
                      className="icon-button"
                      type="submit"
                      title="Revoke token"
                      aria-label={`Revoke ${token.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </form>
                ) : null}
              </article>
            ))
          ) : (
            <p className="empty-copy">No integration tokens have been issued.</p>
          )}
        </div>
      </section>
    </div>
  );
}
