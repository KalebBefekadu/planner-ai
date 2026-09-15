# Health Readiness Least-Privilege Task

- **Goal:** remove the Supabase admin client from the public health route while
  retaining a bounded, content-free dependency readiness check.
- **Owner:** Codex lead
- **Branch:** `codex/health-readiness-least-privilege`
- **Base:** `codex/admin-client-boundary` at `1342c58`.
- **Dependencies:** the EH-01 admin-client migration register and Supabase's
  publishable-key API gateway contract.
- **Writable paths:** `.agents/ACTIVE.md`,
  `.agents/tasks/health-readiness-least-privilege.md`, the matching handoff,
  `docs/engineering/admin-client-boundary.md`,
  `web/src/app/api/health/route.ts`,
  `web/tests/unit/admin-client-boundary.test.ts`, and
  `web/tests/unit/health-route.test.ts`.
- **Forbidden paths:** other application routes, database schema/migrations,
  generated types, production configuration/data/credentials, deployment
  settings, and other worktrees.

## Deliverables

1. Probe the Supabase REST boundary with the configured publishable key, a
   bounded timeout, no user token, and no private table query.
2. Preserve the existing canonical-mode, no-store, `ok`/`not_ready` response
   contract.
3. Add focused tests for canonical-mode rejection, successful dependency
   readiness, non-OK dependency responses, and network/configuration failures.
4. Remove the health route from the executable and documented service-role
   migration exceptions.

## Acceptance

- The health route no longer imports or constructs the admin client.
- The probe sends the publishable key only in the `apikey` header and never
  exposes it in the response.
- A failed, unavailable, or misconfigured dependency returns `503 not_ready`.
- The admin-boundary test becomes strictly smaller.
- `npm run agent:check` and `npm test` pass under Node 24.21.0.

## Verification

Run from `web/` with Node 24.21.0:

```bash
npm ci
npm run agent:check
npm test
```

## Handoff

`.agents/handoffs/health-readiness-least-privilege.md`
