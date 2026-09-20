# Planner Summary UI Boundary Handoff

## Behavior changed

No product behavior changed. The Planner's period and horizon filters, planning-flow links, overview counters, and drift notice now live in `PlannerSummary`. The stateful workspace retains URL synchronization, mutations, composers, recurrence, and the Goal/Action tree.

## Files changed

- `web/src/components/planner-summary.tsx`
- `web/src/components/planner-workspace.tsx`
- `.agents/ACTIVE.md`, task, and this handoff

## Checks run

- `npm run agent:check` — format, lint, and typecheck passed without warnings.
- `npx vitest run` — 94 files and 1,068 tests passed.
- `npm run build` — production build passed and generated all 43 routes.
- `journey-planner.spec.ts`, Chromium, one worker — 11 passed, including period/horizon filtering, reload/back/forward persistence, overview counts, and nested work.
- `git diff --check` — passed.

## Diagnosis note

The repository wrapper did not propagate local Supabase values when Playwright arguments were appended, and a nested-shell retry failed to bring up its server. Direct Playwright execution against the already reset local stack on an alternate port passed. No product assertion failed in either harness-only attempt.

## Risks and blockers

- The extraction deliberately passes primitive counts and filter callbacks instead of moving workspace state, keeping the ownership boundary one-way.
- No styles, routes, Operations, schema, or database behavior changed.

## Commit

Recorded after the implementation commit.
