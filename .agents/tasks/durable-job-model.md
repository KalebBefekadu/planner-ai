# Durable Job Model Task

- **Goal:** give account deletion the durable-job model this schema already
  uses for notification delivery, so a request abandoned by a dead worker is
  recovered rather than lost.
- **Owner:** Codex lead
- **Branch:** `codex/durable-job-model`
- **Base:** `codex/mcp-grant-contract` at `809dc6d`.
- **Writable paths:** `.agents/ACTIVE.md`, this contract, the matching handoff,
  `web/supabase/migrations/20260915220000_account_deletion_is_never_stuck.sql`,
  `web/supabase/tests/account_deletion_is_never_stuck.sql`,
  `web/src/app/api/internal/account-deletions/route.ts`, and
  `web/src/types/supabase.generated.ts`.
- **Forbidden paths:** the other lifecycle routes, application code, production
  configuration/data/credentials, and other worktrees.

## Deliverables

1. `attempt_count` and `next_attempt_at` on `account_deletion_requests`.
2. An atomic claim with a fifteen-minute visibility timeout and
   `for update skip locked`, plus release-with-backoff and complete.
3. The route claiming through it, with each deletion wrapped so a throw
   releases the claim rather than waiting out the timeout.
4. pgTAP proving a stale claim is recovered, a live one is not stolen, attempts
   count, backoff applies, and completing an unclaimed request does nothing.

## Acceptance

- Attempts are not capped; a deletion is never silently abandoned.
- `npm run agent:check`, `npm test`, `npm run verify:db`, `npm run build` and
  the auth-boundary browser tests pass under Node 24.21.0.

## Handoff

`.agents/handoffs/durable-job-model.md`
