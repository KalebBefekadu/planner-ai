# WS-04: Preserve the onboarding import report

## Owner

Codex implementation worker.

## Goal

Keep the completed item-level import report visible in the onboarding center until the user explicitly dismisses it.

## Writable paths

- `web/src/components/note-import-dialog.tsx`
- `web/src/components/onboarding-center.tsx`
- `web/tests/e2e/journey-onboarding-center.spec.ts`
- `.agents/tasks/WS-04-import-dogfood.md`

## Acceptance

- Completing an onboarding import does not close its reconciliation report.
- Notes can still refresh after import through the existing optional callback.
- Browser coverage proves the completed count and item disposition remain visible.
- `npm run agent:check` passes.
