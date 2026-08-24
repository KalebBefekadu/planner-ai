# Planner AI Web

This Next.js application is the only Planner AI product shell. It owns the click-first workspace, authenticated browser session, docked assistant, shared Operation registry, and MCP endpoint.

## Prerequisites

- Node.js 24 and npm 11, pinned by `package.json`, `.nvmrc`, and CI.
- A Supabase project. The legacy model remains available during cutover; new capabilities require the canonical migrations.
- A Groq API key for assistant, planning, and transcription routes.
- A Resend API key only when using the server-side invitation flow.

## Configuration

Create `web/.env.local` with these names. Never commit values.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GROQ_API_KEY=
RESEND_API_KEY=
NOTIFICATION_EMAIL_FROM=
CRON_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
PLANNER_DATA_MODEL=legacy
```

The `NEXT_PUBLIC_` values are designed for the browser and are not administrative credentials. Never place a Supabase service-role key, database password, OAuth client secret, or provider secret in a `NEXT_PUBLIC_` variable.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Set `PLANNER_DATA_MODEL=canonical` only after every migration in `supabase/migrations` has been applied and verified. The service-role key is server-only and is limited to invitation lifecycle work, manual MCP gateway execution, and scheduled internal workers. `CRON_SECRET` authenticates only those worker routes and must be a long random server-only value. `NOTIFICATION_EMAIL_FROM` must be a verified Resend sender.

Canonical mode adds durable daily focus, Action/Goal editing and movement, Weekly/Monthly/Quarterly Review, hierarchical Markdown Notes with validated import and preview, server-enforced AI consent, evidence-linked assistant responses, scoped MCP, expanded export, and cancellable account deletion. Private binary Note attachments remain disabled until malware quarantine and Storage recovery are configured.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:db
npm run audit
```

Database tests require Docker or another compatible local Supabase runtime. Remote migration, generated-type drift, OAuth/SMTP configuration, and recovery drills must be completed against the owned Supabase project before beta.

Schedule an authenticated `POST` to `${NEXT_PUBLIC_APP_URL}/api/internal/account-deletions` after configuring `CRON_SECRET`. The worker claims due requests in batches and permanently deletes the Supabase identity only after its seven-day cancellation window.

Schedule an authenticated `POST` to `${NEXT_PUBLIC_APP_URL}/api/internal/notifications` at least hourly after configuring `CRON_SECRET`, `RESEND_API_KEY`, and `NOTIFICATION_EMAIL_FROM`. The worker honors each Workspace timezone and quiet hours, sends at most one generic count-only reminder per local day, and retries transient failures with the same provider idempotency key.

## MCP OAuth

The MCP endpoint is `${NEXT_PUBLIC_APP_URL}/api/mcp`. It publishes RFC 9728 protected-resource metadata and uses Supabase Auth as the OAuth 2.1 authorization server. In the Supabase dashboard, enable OAuth Server, dynamic client registration, asymmetric JWT signing, and set the authorization path to `${NEXT_PUBLIC_APP_URL}/oauth/consent`. Planner AI requires AAL2 before consent and stores product capability grants separately from OAuth identity scopes.

Official references: [Supabase MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication) and [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

See [MCP setup and recovery](../docs/mcp-setup-and-recovery.md) for host connection, minimum grants, revocation, and error recovery. Production response, cutover, backup, and restore procedures live in the [production runbook](../docs/production-runbook.md).

## Architecture Boundary

- Supabase remains the domain system of record.
- Canonical persistent writes use the shared Operation service.
- AI output is untrusted until schema validation and authorization succeed.
- Raw Capture text must be preserved exactly before AI interpretation.
- Agent Native is a source of reviewed patterns, not a first-release runtime or second data owner.

See the [repository README](../README.md), [current-state audit](../docs/current-state-audit.md), and [target architecture](../architecture.md) before changing product boundaries.
