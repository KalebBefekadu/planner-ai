# PL-05: Direct Action creation on Today

Owner: Claude implementation worker. Codex is integration lead and reviewer.
Branch: claude/pl-05-direct-action, based on integration/dogfood.
Issue: https://github.com/KalebBefekadu/planner-ai/issues/117

## Scope

Implement a real Today composer with title, optional authorized Goal and optional focus. Use existing action.create.v1 and daily-focus.set.v1 Operations. Preserve a saved Action when focus fails. Reuse creation idempotency keys for the same payload; a corrected payload needs a new key if the contract binds keys to payloads. Never truncate existing focus to fit a new Action. Refresh all affected paths including /planner/today. Reuse periodBounds from src/lib/planning-period.ts with workspace-local date and week_starts_on; do not copy the old hardcoded Monday rangeFor helper.

## Writable paths

- web/src/app/today/actions.ts
- web/src/components/today-workspace.tsx
- web/tests/e2e/journey-today.spec.ts
- web/tests/unit/today-creation.test.ts (only if meaningful orchestration coverage can use existing test patterns)
- .agents/reports/PL-05-handoff.md

## Boundaries

No migrations, generated types, lockfiles, global CSS, Preview edits, environment files, secrets, external services, shell commands, commits or pushes. Codex runs checks and commits after review. Use existing form/control classes. Preserve user input across network/partial failure, derive dates server-side, and avoid overwriting concurrent focus blindly. If a contract change is indispensable, record the exact gap instead of changing forbidden files.

## Acceptance

- Title-only and Goal-linked Action creation persists on reload and works without AI.
- Full focus capacity leaves the created Action available with an honest status.
- Retry after successful creation never creates a second Action.
- Stale/denied Goal, double submit and workspace timezone/week start have explicit handling.
- The composer is accessible on mobile and keyboard; use an inline form to avoid a new unfocused modal.
- Handoff distinguishes implementation from unrun checks and documents residual concerns.

## Review corrections

The previous read-only audit missed the existing periodBounds helper and suggested silently slicing focus. Do not adopt either suggestion. Existing server date helpers and Operation contracts remain authoritative.
