# Restricted Proposal Worker Task

- **Goal:** remove `createAdminClient()` from the three AI proposal routes by
  introducing a restricted, `auth.uid()`-derived job capability, without
  weakening job claiming, Workspace isolation, AI quota accounting,
  idempotency, or Operation governance.
- **Owner:** Codex lead
- **Branch:** `codex/proposal-worker-capability`
- **Base:** `codex/health-readiness-least-privilege` at `64c15cf`.
- **Dependencies:** the EH-01 admin-client migration register, the `ai_jobs`
  status contract, and the two job-bound proposal persistence functions.
- **Writable paths:** `.agents/ACTIVE.md`,
  `.agents/tasks/restricted-proposal-worker.md`, the matching handoff,
  `docs/engineering/admin-client-boundary.md`,
  `web/supabase/migrations/20260915160000_restricted_proposal_worker.sql`,
  `web/supabase/tests/ai_job_status.sql`,
  `web/supabase/tests/restricted_proposal_worker.sql`,
  `web/src/lib/ai/job-status.ts`,
  `web/src/app/api/capture-proposals/route.ts`,
  `web/src/app/api/review-proposals/route.ts`,
  `web/src/app/api/initiative-breakdown/route.ts`,
  `web/src/types/supabase.generated.ts`, and
  `web/tests/unit/admin-client-boundary.test.ts`.
- **Forbidden paths:** other application routes, the admin constructor, the
  lifecycle allowlist routes, production configuration/data/credentials,
  deployment settings, and other worktrees.

## Why the admin client is there

The three routes already read their domain evidence through the person's JWT.
Service-role access is used for exactly two things:

1. `ai_jobs` writes. `authenticated` holds `SELECT` only; every insert and
   status update needs `service_role`.
2. `persist_capture_proposal_analysis_job` and `persist_review_ai_proposal_job`.
   Both are `security definer` with a fixed `search_path`, but both accept
   `p_owner_user_id` as a **trusted parameter**, so execute is granted to
   `service_role` alone. Any caller able to execute them could assert any owner.

## Two defects found in the same surface

Both block `initiative_breakdown` and both are fixed here, because the route
cannot be migrated to a capability it can never reach.

1. `20260915140000_suggest_a_breakdown.sql` added `initiative_breakdown` to
   `ai_jobs_operation_check` but never to `ai_jobs_source_shape_check`, whose
   two branches name `capture_analysis` and `review_analysis` only. Every
   breakdown job insert is rejected. Verified against the live local schema:
   the constraint expression evaluates to `false` for a breakdown row.
2. `persist_capture_proposal_analysis_job` matches
   `job.operation = 'capture_analysis'`, so a breakdown job would fail job
   claiming even with the constraint fixed.

## Deliverables

1. A restricted capability of four `security definer` functions that derive the
   actor from `auth.uid()` and the Workspace from ownership, never from a
   parameter: `start_ai_job`, `complete_ai_job`, `fail_ai_job`, and the two
   persistence functions with `p_owner_user_id` removed.
2. `ai_jobs` table grants unchanged. `authenticated` keeps `SELECT` only; the
   capability is the sole write path.
3. Fixed `search_path`, `revoke all ... from public, anon` before any grant, and
   execute granted to `authenticated` alone. The old `p_owner_user_id`
   signatures are dropped, not left callable.
4. `ai_jobs_source_shape_check` extended to cover `initiative_breakdown`, and
   job claiming widened to the breakdown operation.
5. One shared server module, `web/src/lib/ai/job-status.ts`, used by all three
   routes, so job status policy cannot drift between them.
6. Negative pgTAP coverage: anonymous execute denied, cross-Workspace job
   claiming denied, direct table writes still denied, superseded analysis still
   rejected, and the removed signatures gone.
7. The three routes removed from the executable and documented service-role
   migration exceptions.

## Acceptance

- None of the three routes imports or constructs the admin client.
- No new `service_role` consumer and no new table-level write grant appears.
- `initiative_breakdown` can start, persist, and complete a job.
- The admin-boundary test becomes strictly smaller: seven exceptions to four.
- `npm run agent:check`, `npm test`, and `npm run verify:db` pass under
  Node 24.21.0.

## Verification

Run from `web/` with Node 24.21.0:

```bash
npm ci
npm run agent:check
npm test
npm run verify:db
```

## Handoff

`.agents/handoffs/restricted-proposal-worker.md`
