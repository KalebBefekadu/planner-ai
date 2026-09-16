# Durable Job Model Handoff

- **Task:** `.agents/tasks/durable-job-model.md`
- **Branch:** `codex/durable-job-model`
- **Base:** `codex/mcp-grant-contract` at `809dc6d`

First slice of EH-07. It does not build a queue; it gives the job that needed it
the model this schema already had.

## The defect

`/api/internal/account-deletions` claimed a request by flipping it to
`processing`, deleted the Auth user, then wrote `completed`. The success path
and the handled failure path both release the claim. **Nothing released it if
the process stopped between them** — a timeout, a deploy, a function killed
mid-execution, or `deleteUser` throwing rather than returning an error, which
the loop had no `try` around.

The cron only ever selected `status = 'scheduled'`, so a row left in
`processing` was never looked at again. `processing_started_at` was written and
never read by anything.

Verified against the live database before changing anything: a request stuck in
`processing` for six hours, with `scheduled_for` a month past, is seen by the
worker's query zero times.

This is the worst job in the system to lose. Somebody asked to be deleted, and
the request stops — with nothing failing, nothing retrying, and nothing saying
so. `lifecycle_job_runs` counts what each run touched, so a run that touches
nothing looks like a quiet day.

## Why this is not a new queue

**The model already exists in this schema.**
`notification_email_deliveries` has attempt counting, a `claimed_at` visibility
timeout, `next_attempt_at` backoff, and claims atomically in one statement.
It is correct, and it is implemented once — for notifications.

So this gives account deletion the same model rather than inventing a second
one: `attempt_count`, `next_attempt_at`, and three `security definer` functions
— claim, release, complete — with the claim doing `for update skip locked` in a
single statement so two overlapping runs cannot take the same request.

The visibility timeout is fifteen minutes, matching the notification one.

## One deliberate difference, and it is a product question

Notifications stop after five attempts. That is right for an email.

**Attempts are not capped here.** Abandoning a deletion request is a decision
about what the product owes a person, not a technical default, so this retries
with a widening backoff — 4 minutes, 16, 64, then hours, levelling off around
seventeen — and records `attempt_count` so a stalled request is visible rather
than silently dropped. If there should be a terminal state, that is a decision
to make explicitly, and it needs somewhere for a stalled request to surface.

## Behavior changed

- A deletion request abandoned by a dead worker is picked up again after fifteen
  minutes instead of never.
- Every attempt is counted, and a failure sets a backoff instead of retrying on
  the next tick.
- The route wraps each deletion in `try`, so `deleteUser` throwing releases the
  claim immediately rather than leaving it to the timeout.
- The response reports `reclaimed` alongside `processed` and `completed`, so a
  request that had to be recovered is visible in the run.

## Files changed

- `.agents/ACTIVE.md`, the task and this handoff
- `web/supabase/migrations/20260915220000_account_deletion_is_never_stuck.sql`
- `web/supabase/tests/account_deletion_is_never_stuck.sql` (new)
- `web/src/app/api/internal/account-deletions/route.ts`
- `web/src/types/supabase.generated.ts`

## Verification

Run in `web/` with Node 24.21.0:

- `npm run agent:check` — passed.
- `npm test` — passed; 87 files, 1,006 tests, unchanged.
- `npm run test:db` — passed; 73 files, 1,326 assertions, up from 72 and 1,308.
- `npm run verify:db` — passed.
- `npm run build` — passed.
- `npx playwright test auth-boundary --project=chromium` — 17 passed, including
  the scheduler-secret tests that guard this route.

## Risks and follow-up

- **The other three lifecycle jobs do not have this bug**, and I checked rather
  than assumed: notifications claims through an RPC with its own timeout, and
  both purges claim at the moment of effect with a compare-and-swap delete, so
  a dead worker leaves no intermediate state. Two concurrent purge runs can do
  duplicate Storage work, but not duplicate effect. Only account deletion had a
  two-phase claim.
- EH-07's remaining bullet is the larger one: enqueueing background work
  atomically with the domain transaction that starts it. Nothing here does that
  — every job is still a cron scan over a domain table. That is a real design
  change and wants its own contract, and it should probably wait until there is
  a job that a scan genuinely cannot serve.
- A stalled request is now *visible in the data* but nothing *surfaces* it. The
  `reclaimed` count and `attempt_count` are what an alert would read; building
  that alert belongs with EH-06.
