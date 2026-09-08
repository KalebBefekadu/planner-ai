# PL-02: Planner-scoped daily routes

## Owner

Codex implementation worker.

## Goal

Keep Today and Action Inbox inside the Planner navigation context without removing the Preview-style Home area or duplicating application behavior.

## Writable paths

- `web/src/lib/experience-navigation.ts`
- `web/src/app/planner/today/page.tsx`
- `web/src/app/planner/inbox/page.tsx`
- `web/tests/unit/experience-navigation.test.ts`
- `web/tests/e2e/journey-today.spec.ts`
- `.agents/tasks/PL-02-planner-scoped-routes.md`

## Acceptance

- Planner sidebar links resolve only to Planner-scoped paths.
- Today and Action Inbox reuse their authoritative real pages.
- Home remains a distinct top-level Preview-style area.
- Focused unit coverage and `npm run agent:check` pass.
