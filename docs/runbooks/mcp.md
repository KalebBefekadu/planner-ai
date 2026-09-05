# Planner AI MCP Setup And Recovery

Planner AI exposes one product-only Streamable HTTP endpoint at `${NEXT_PUBLIC_APP_URL}/api/mcp`. It never exposes SQL, shell access, repository access, deployment controls, authentication policy, provider credentials, or Supabase service-role authority.

## Recommended OAuth Connection

1. In Planner AI, complete authenticator verification under **Settings > Security**.
2. Add the MCP endpoint shown under **Settings > AI connections** to a standards-capable MCP host.
3. Let the host discover Planner AI's protected-resource and authorization-server metadata.
4. Sign in to Planner AI, review the exact requested capabilities, and approve only those needed.
5. Confirm the connection appears under OAuth connections and inspect its last-used state.

Read access is the default. Writes are individually allowlisted and remain subject to the same validation, risk classification, Activity, and approval boundaries as the product. Offline access is never implied by an interactive session.

## Manual Token Fallback

Use a manual token only when the host cannot complete OAuth. After an AAL2 security check, choose a short expiry and minimum capabilities. Planner AI displays the plaintext token once and stores only its hash. Put the token in the host's secret/authorization field as a Bearer token; never paste it into chat, Notes, screenshots, source files, logs, or support messages.

## Revoke And Recover

- Lost or exposed credential: revoke it immediately under **Settings > AI connections**, remove it from the host, and create a replacement with narrower capabilities.
- Unexpected capability denial: inspect the grant in Planner AI and reconnect only if the missing capability is genuinely required. Do not broaden a token to silence an error.
- `401`: the token or OAuth session is missing, expired, revoked, or has the wrong audience. Reauthenticate.
- `403`: origin or capability is not allowed, or step-up approval is required. Review the host and exact Operation.
- `429`: the per-grant rate limit was reached. Back off; do not rotate credentials to evade it.
- `503`: canonical data or OAuth infrastructure is unavailable. Keep using the click-first product and retry later.

Revocation is the first containment action. Planner AI records grant creation, use, denial, and revocation without storing request content or plaintext credentials.

## Production Prerequisites

Before OAuth MCP is enabled, the owned Supabase project must have OAuth Server, dynamic client registration, asymmetric JWT signing, and the Planner AI `/oauth/consent` authorization path configured. Test authorization-code exchange, audience binding, PKCE, refresh rotation, expiry, replay, revocation, cross-Workspace denial, and a real host connection before beta.
