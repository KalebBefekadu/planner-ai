# Health Readiness Least-Privilege Handoff

- **Task:** `.agents/tasks/health-readiness-least-privilege.md`
- **Branch:** `codex/health-readiness-least-privilege`
- **Implementation commit:** `b85e1fe`

## Behavior changed

- `/api/health` no longer constructs the Supabase admin client or reads any
  private table.
- Readiness now probes the Supabase REST API boundary with the configured
  publishable key in the `apikey` header, no user token, no response content,
  and a three-second timeout.
- Canonical-mode rejection and the existing `ok`/`not_ready`, status-code, and
  no-store response contract remain unchanged.
- The executable admin-client migration inventory is strictly smaller: four
  lifecycle consumers and seven temporary ordinary-route exceptions remain.

## Files changed

- `.agents/ACTIVE.md`
- `.agents/tasks/health-readiness-least-privilege.md`
- `docs/engineering/admin-client-boundary.md`
- `web/src/app/api/health/route.ts`
- `web/tests/unit/admin-client-boundary.test.ts`
- `web/tests/unit/health-route.test.ts`

## Verification

Run in `web/` with Node 24.21.0:

- `npm ci` — passed; 768 packages installed, 0 vulnerabilities.
- Focused health and admin-boundary tests — passed; 5/5.
- Real local Supabase publishable-key REST probe — returned HTTP 200 while the
  repository-wide Supabase lock was held; no key was printed.
- `npm run agent:check` — passed; formatting, ESLint, and TypeScript clean.
- `npm test` — passed; 81 files and 927 tests.
- Targeted formatting and `git diff --check` — passed.

## Risks and follow-up

- The readiness probe proves the API gateway and PostgREST boundary respond; it
  deliberately does not bypass RLS or inspect private data. Deeper dependency
  health belongs in private operational telemetry, not this public route.
- Seven ordinary routes still use the admin client. The next coherent slice is
  a restricted worker capability shared by Capture proposals, Review proposals,
  and Initiative breakdown.
- The route was verified against the local Supabase gateway and unit contracts;
  GitHub Actions and the hosted Supabase endpoint have not yet exercised this
  branch.
