# PL-03: Today convergence

## Owner

Codex implementation worker.

## Goal

Bring the canonical Today screen closer to the accepted Planner reference without replacing its real focus, completion, editing, and failure behavior.

## Writable paths

- `web/src/components/today-workspace.tsx`
- `web/src/app/globals.css`
- `web/tests/e2e/journey-today.spec.ts`
- `.agents/tasks/PL-03-today-convergence.md`

## Acceptance

- Today uses the accepted outcome-focused hierarchy and language.
- Real Planner views are directly reachable from a stable horizontal navigation.
- Action capture and Inbox links remain inside Planner context.
- Existing canonical data and Operations are unchanged.
- `npm run agent:check` and focused coverage pass.
