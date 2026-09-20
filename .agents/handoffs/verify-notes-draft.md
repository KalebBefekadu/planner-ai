# Notes Draft Extraction Verification

## Behavior verified

- Note draft ownership, debounced saving, queued writes, conflict recovery, and local draft recovery live in `useNoteDraft` instead of the Workspace component.
- Leaving a Note before its debounce expires flushes the edit to the Note where it was typed.
- Search navigation may tear down the editor without discarding the last edit.
- The Notes Workspace is smaller and delegates the save lifecycle through a focused controller.

## Implementation reviewed

- `web/src/components/notes-workspace.tsx`
- `web/src/lib/notes/use-note-draft.ts`
- `web/src/lib/notes/use-note-draft.test.tsx`
- `web/tests/e2e/journey-notes.spec.ts`
- `web/tests/e2e/support/workspace.ts`

## Checks run

- Node 24.21.0: `npm ci` — passed; 781 packages installed.
- Focused draft-controller suite — 1 file, 6 tests passed.
- Full unit suite — 94 files, 1,068 tests passed.
- `npm run agent:check` — formatting, lint, and typecheck passed.
- Notes autosave navigation journey — Chromium and mobile Chromium passed first attempt.
- Favourite persistence journey — Chromium passed first attempt; mobile Chromium passed in isolation with retries disabled.

## Known test-infrastructure behavior

Running all four targeted browser cases concurrently produced one mobile setup failure before the Notes journey began. The page showed the application error boundary and the server logged `Unable to load Workspace preferences`. The same case passed in isolation in 16.5 seconds. This is consistent with the repository's documented small local Auth stack saturating under concurrent signup/onboarding, and is separate from the verified Notes behavior.

## Commits

- `94ff8f4` — preserve edits while search tears down the page.
- `1e5f1d4` — extract the Note editor save pipeline.
- The verification record is committed on `codex/verify-notes-draft`.
