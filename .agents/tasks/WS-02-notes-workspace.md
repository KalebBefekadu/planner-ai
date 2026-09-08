# WS-02: Real Notes workspace frame

## Owner

Codex implementation worker.

## Goal

Make the authenticated Notes route use the accepted Preview workspace structure without replacing real Notes behavior or importing fixtures.

## Writable paths

- `web/src/components/experience-shell.tsx`
- `web/src/app/globals.css`
- `web/tests/unit/design-tokens.test.ts`
- `.agents/tasks/WS-02-notes-workspace.md`

## Acceptance

- Notes has one document-tree sidebar rather than a generic Workspace sidebar plus a second Notes sidebar.
- The shared shell control collapses and restores the real Notes tree.
- Mobile navigation remains available through the shared drawer and bottom navigation.
- Canonical Notes data, authorization, Operations, editor, import, export, and recovery behavior are unchanged.
- Formatting, lint, type checking, focused unit tests, and affected browser verification pass.
