# Admin Client Boundary Handoff

- **Task:** `.agents/tasks/admin-client-boundary.md`
- **Branch:** `codex/admin-client-boundary`
- **Implementation commit:** `7b8a293`

## Behavior changed

- CI's unit suite now fails if any new runtime module imports the Supabase admin
  client or if another source module reads `SUPABASE_SERVICE_ROLE_KEY`.
- The intended final allowlist is explicit: four cron-authenticated lifecycle
  routes for account deletion, attachment purge, import purge, and notification
  delivery.
- Eight ordinary request paths are named as temporary migration exceptions with
  a removal direction and order; they are no longer implicitly approved merely
  because they already exist.
- The boundary test also proves the one key reader remains a server-only module.

## Files changed

- `.agents/ACTIVE.md`
- `.agents/tasks/admin-client-boundary.md`
- `docs/engineering/admin-client-boundary.md`
- `web/tests/unit/admin-client-boundary.test.ts`

## Verification

Run in `web/` with Node 24.21.0:

- `npm ci` — passed; 770 packages installed, 0 vulnerabilities.
- Focused admin-boundary tests — passed; 2/2.
- `npm run agent:check` — passed; formatting, ESLint, and TypeScript clean.
- `npm test` — passed; 80 files and 924 tests.
- Targeted Markdown/TypeScript formatting and `git diff --check` — passed.

## Risks and follow-up

- This is an enforcement ratchet, not the completion of EH-01. Eight ordinary
  routes still construct an admin client after their own authorization checks.
- The contract detects canonical admin-module imports and direct reads of the
  canonical service-role environment key. Deliberately inventing another key or
  constructor would still require code review and should be rejected.
- The health route is the smallest migration exception and should move first to
  a public-key dependency probe that reveals no private rows.
- Proposal workers, MCP, attachments/export, and pre-auth invitation claims need
  separate design and regression evidence; do not collapse them into one broad
  refactor.
