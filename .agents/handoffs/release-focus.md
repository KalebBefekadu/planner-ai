# Release Focus And Notes Recovery UI Handoff

## Decisions recorded

- The owner-dependent Notion pilot is removed from the current delivery program; the release makes no complete Notion-replacement claim.
- Declarative schemas, live tracing/SLO certification, and external MCP certification are deferred until after personal dogfood.
- The active release gates are production migrations, backup custody, recovery evidence, and locally justified UI boundaries.

## Behavior changed

No product behavior changed. Notes conflict comparison and recoverable-draft prompts moved from the 1,792-line workspace into `note-recovery-panels.tsx`; the draft hook still owns all save and resolution state.

## Verification

- `npm run agent:check` — passed.
- `npx vitest run` — 94 files and 1,068 tests passed.
- `npm run build` — passed; all 43 routes generated.
- `note-conflict-recovery.spec.ts` — 4 passed across desktop and mobile Chromium.
- `git diff --check` — passed.

## Production findings

- Read-only migration inspection found seven local-only migrations, `20260915090000` through `20260915150000`.
- The guarded preflight stopped on that expected drift.
- A fresh encrypted backup attempt stopped before creating an archive because the protected release file's database password is no longer accepted by the correctly shaped shared-pooler connection.
- No production mutation occurred. Migration and fresh recovery evidence remain blocked until the owner refreshes `PLANNER_PRODUCTION_DATABASE_URL` in the gitignored `web/.env.release.local` file.

## Commit

Recorded after the implementation commit.
