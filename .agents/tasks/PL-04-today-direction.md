# PL-04: Today direction

## Owner

Codex implementation worker.

## Goal

Show the real Goal advanced by today's work so the canonical daily loop has the accepted Preview direction band without fixture content.

## Writable paths

- `web/src/components/today-workspace.tsx`
- `web/src/app/globals.css`
- `web/tests/e2e/journey-today.spec.ts`
- `.agents/tasks/PL-04-today-direction.md`

## Acceptance

- Today derives direction from real linked Action data.
- An unlinked day receives a useful deterministic empty state.
- The Goal destination stays inside Planner navigation.
- Existing Operations and loaders are unchanged.
- `npm run agent:check` passes.
