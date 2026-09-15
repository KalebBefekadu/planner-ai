# Reproducible Delivery Handoff

- **Task:** `.agents/tasks/reproducible-delivery.md`
- **Branch:** `codex/reproducible-delivery`
- **Implementation commit:** `c81c042`

## Behavior changed

- Local commands that use the fixed `planner-ai` Supabase project now share a
  fail-fast repository lock with branch, process, and worktree diagnostics.
- Database verification now starts the stack, resets from every migration, runs
  pgTAP, regenerates formatted types into a temporary file, and checks drift in
  one locked session.
- Explicit type generation uses the same clean-reset path before atomically
  replacing the checked-in type file.
- CI's database job calls the checked-in `npm run verify:db` contract instead of
  maintaining a second command sequence.
- The clean reset exposed and reconciled missing Goal fields and Action/Review
  database functions in the generated Supabase types.
- Successful Supabase startup output is suppressed by the wrapper so ephemeral
  local keys do not enter normal terminal or database-job logs.

## Files changed

- `.agents/ACTIVE.md`
- `.agents/README.md`
- `.agents/tasks/reproducible-delivery.md`
- `.github/workflows/ci.yml`
- `web/package.json`
- `web/scripts/verify-local-database.sh`
- `web/scripts/with-local-supabase-lock.sh`
- `web/src/types/supabase.generated.ts`
- `web/tests/unit/local-supabase-lock.test.ts`

## Verification

Run in `web/` with Node 24.21.0:

- `npm ci` — passed; 768 packages installed, 0 vulnerabilities.
- Focused lock tests — passed; 2/2.
- `npm run verify:db` — passed after a clean reset; 68 pgTAP files and
  1,197 assertions, with generated types consistent.
- `npm run agent:check` — passed; formatting, ESLint, and TypeScript clean.
- `npm test` — passed; 79 files and 922 tests.
- Shell syntax and `git diff --check` — passed.
- Two independent worktrees resolve the same Git common directory, which is the
  default lock location.

## Risks and follow-up

- This slice deliberately serializes one fixed local stack instead of starting
  a full Docker stack per worktree. A second command fails immediately with
  owner diagnostics; it does not queue.
- Raw `npx supabase` mutation commands can bypass the repository wrapper. The
  agent protocol now forbids concurrent raw use, but this is a workflow
  boundary rather than an operating-system sandbox.
- A process terminated without running shell traps can leave a stale lock. The
  diagnostic names its exact path and requires verifying no Supabase command is
  active before removal.
- GitHub Actions has not yet run the consolidated database job on this branch.
- The browser CI job still starts its own stack directly, which is safe because
  each GitHub job has an isolated runner; local browser runs use
  `npm run test:e2e:local`.
