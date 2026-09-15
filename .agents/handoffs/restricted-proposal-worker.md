# Restricted Proposal Worker Handoff

- **Task:** `.agents/tasks/restricted-proposal-worker.md`
- **Branch:** `codex/proposal-worker-capability`
- **Base:** `codex/health-readiness-least-privilege` at `64c15cf`

## Behavior changed

- Capture proposals, Review proposals, and Initiative breakdown no longer
  construct the Supabase admin client. All three write job status through one
  restricted capability: `start_ai_job`, `complete_ai_job`, `fail_ai_job`, and
  the two job-bound persistence functions.
- Each capability function derives the actor from `auth.uid()` and the Workspace
  from ownership inside the database. The two persistence functions previously
  accepted `p_owner_user_id` as a trusted argument, which is why they could only
  be granted to `service_role`; those signatures are dropped, not left callable.
- `ai_jobs` table grants are unchanged. `authenticated` still holds `SELECT`
  only, so the capability is the sole write path and no `BYPASSRLS` role takes
  part in an ordinary request.
- Job claiming, the advisory lock, the superseded check, quota accounting, the
  `request_id` idempotency guard, and every response code and message are
  unchanged. A repeated `request_id` now returns the job it already started
  instead of failing the second attempt.
- The executable admin-client inventory is strictly smaller: four lifecycle
  consumers and four ordinary-route exceptions, down from seven.

## Two defects fixed in the same surface

Both blocked `initiative_breakdown` entirely, and both are covered by new
assertions that would have caught them.

1. `20260915140000_suggest_a_breakdown.sql` added `initiative_breakdown` to
   `ai_jobs_operation_check` but not to `ai_jobs_source_shape_check`, whose two
   branches name `capture_analysis` and `review_analysis` only. Every breakdown
   job insert was rejected by the check constraint, so the route returned
   `503 job_status_unavailable` after creating a Capture and consuming quota.
   Verified against the live local schema before the change: the constraint
   expression evaluates to `false` for a breakdown row.
2. `persist_capture_proposal_analysis_job` claimed only
   `job.operation = 'capture_analysis'`, so a breakdown job could not be claimed
   by the function the breakdown route calls. Claiming now covers both.

## One guard removed deliberately

`persist_review_ai_proposal` rejected any call whose request claimed a role
other than `service_role`, and reported that authorization failure as
`invalid_review_proposal`. It was the only function in the schema with such a
guard; its Capture-side twin relies on its EXECUTE grant alone.

The grant is the control. The function stays revoked from `public`, `anon` and
`authenticated` — now asserted explicitly in pgTAP — so the only ways in are
`service_role` and the job function, which refuses any job the caller does not
own. Every payload validation is byte-identical; the function body was
regenerated from the original migration with only that one term removed.

Net authorization is tighter than before: the caller used to name the owner, and
now cannot.

## Files changed

- `.agents/ACTIVE.md`
- `.agents/tasks/restricted-proposal-worker.md`
- `.agents/handoffs/restricted-proposal-worker.md`
- `docs/engineering/admin-client-boundary.md`
- `web/supabase/migrations/20260915160000_restricted_proposal_worker.sql`
- `web/supabase/tests/restricted_proposal_worker.sql`
- `web/supabase/tests/ai_job_status.sql`
- `web/supabase/tests/review_ai_job_freshness.sql`
- `web/src/lib/ai/job-status.ts`
- `web/src/app/api/capture-proposals/route.ts`
- `web/src/app/api/review-proposals/route.ts`
- `web/src/app/api/initiative-breakdown/route.ts`
- `web/src/types/supabase.generated.ts`
- `web/tests/unit/admin-client-boundary.test.ts`

## Verification

Run in `web/` with Node 24.21.0, holding the repository-wide Supabase lock:

- `npm ci` — passed; 770 packages, 0 vulnerabilities.
- `npm run agent:check` — passed; Prettier, ESLint, and TypeScript clean.
- `npm test` — passed; 81 files, 927 tests.
- `npm run test:db` — passed; 69 files, 1,231 assertions (baseline 68 / 1,197).
- `npm run types:generate` then `npm run verify:db` — passed; migrations, pgTAP,
  and generated types agree after a clean reset.

## Risks and follow-up

- No browser test exercises these three routes against a live provider, so the
  migration is proven at the database and unit boundary rather than end to end.
  The breakdown path in particular has never run to completion in any
  environment, because it could not start a job until this change.
- Four ordinary routes still use the admin client. Per the removal order, the
  next slice is the MCP route, which should carry its verified actor and
  Workspace through the same kind of capability rather than an admin client.
- `start_ai_job` accepts the operation as text and validates it against the
  three contract values. When EH-04 lands one typed Operation manifest, that
  list should come from the manifest rather than being repeated in SQL.
