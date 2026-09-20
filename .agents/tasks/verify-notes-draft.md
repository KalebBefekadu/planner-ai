# Verify Notes Draft Extraction

- Owner: Codex
- Branch: `codex/verify-notes-draft`
- Base: `claude/notes-draft-extraction` at `1e5f1d4`
- Dependency: `origin/integration/dogfood` at `ef734df`

## Goal

Independently verify the prepared Notes draft-controller extraction and its fix for edits made while search navigation tears down the editor.

## Writable paths

- `.agents/tasks/verify-notes-draft.md`
- `.agents/handoffs/verify-notes-draft.md`

## Reviewed implementation paths

- `web/src/components/notes-workspace.tsx`
- `web/src/lib/notes/use-note-draft.ts`
- `web/src/lib/notes/use-note-draft.test.tsx`
- `web/tests/e2e/journey-notes.spec.ts`
- `web/tests/e2e/support/workspace.ts`

## Acceptance criteria

- Focused draft-controller tests pass.
- Both Notes journey browser projects pass the affected scenarios without relying on retries.
- Standard application checks and the full unit suite pass.
- The implementation branch remains behaviorally focused and clean.

## Verification

- `cd web && npm ci`
- `cd web && npm run agent:check`
- `cd web && npm test`
- affected Playwright Notes journeys on Chromium and mobile Chromium

## Handoff

`.agents/handoffs/verify-notes-draft.md`
