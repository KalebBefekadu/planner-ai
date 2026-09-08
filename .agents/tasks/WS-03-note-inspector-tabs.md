# WS-03: Note inspector tabs

## Owner

Codex implementation worker.

## Goal

Make existing Note properties, links, and history easier to find without changing Notes data, Operations, autosave, import, or recovery behavior.

## Writable paths

- `web/src/components/notes-workspace.tsx`
- `web/src/app/globals.css`
- `web/tests/unit/design-tokens.test.ts`
- `.agents/tasks/WS-03-note-inspector-tabs.md`

## Acceptance

- Existing inspector controls are grouped into Properties, Links, and History views.
- Properties is the default.
- The hardcoded inspector viewport-height calculation is removed.
- Formatting, lint, TypeScript, and focused unit contracts pass.
