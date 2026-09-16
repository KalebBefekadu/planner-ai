# Server Actions As Adapters Task

- **Goal:** begin EH-03's second bullet by lifting the Weekly Review's
  view-model assembly out of its Server Action.
- **Owner:** Codex lead
- **Branch:** `codex/actions-as-adapters`
- **Base:** `codex/operation-owning-domain` at `1a90f96`.
- **Writable paths:** `.agents/ACTIVE.md`, this contract, the matching handoff,
  `web/src/lib/reviews/weekly-view-model.ts`,
  `web/src/app/review/actions.ts`, and
  `web/tests/unit/weekly-view-model.test.ts`.
- **Forbidden paths:** the Operation handlers, other action files, database
  migrations, production configuration/data/credentials, and other worktrees.

## Deliverables

1. The pure view-model assembly extracted, with the queries left in the action.
2. No behaviour change: functions moved rather than rewritten.
3. Coverage for the cases that were previously unreachable, including the
   duplicate-read dedupe, the never-completed Goal, and a cycle in the Goal
   tree.

## Acceptance

- `npm run agent:check`, `npm test`, `npm run build` and the review browser
  journeys pass under Node 24.21.0.

## Handoff

`.agents/handoffs/actions-as-adapters.md`
