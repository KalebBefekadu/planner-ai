# WS-02: Preserve drafts across Notes search

Owner: Codex lead. Branch: `codex/ws-02-search-draft`. Base: `7a956e5`.
Status: active. Parent acceptance: #123, protect unsaved editor input.

Writable paths: `web/src/components/notes-workspace.tsx`, `web/tests/e2e/journey-notes.spec.ts`, this contract, `.agents/ACTIVE.md`, `.agents/reports/WS-02-search-draft.md`. All other paths forbidden.

Reproduce searching before autosave starts. If confirmed, flush pending edits before search navigation, preserve edits and errors when a save fails, and keep existing pending-move protection. Use existing Operations; no database, dependency, Preview, or production changes.

Verify the regression fails before fixing; run focused production-build desktop/mobile search, move, persistence and conflict journeys; run `npm run agent:check`. Commit and record evidence, limitations and SHA.
