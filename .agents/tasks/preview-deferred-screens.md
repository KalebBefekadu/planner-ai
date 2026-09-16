# Preview Deferred Screens Task

- **Goal:** carry out increment 2 of the `/preview` retirement plan — delete the
  six deferred screens whose design record already exists — and leave the route
  itself in place.
- **Owner:** Codex lead
- **Branch:** `codex/remove-preview`
- **Base:** `codex/critical-path-coverage` at `bdc9162`.
- **Dependencies:** increment 1, the reference captures in
  `docs/product/preview-reference/`. Verified complete before starting.
- **Writable paths:** `.agents/ACTIVE.md`, this contract, the matching handoff,
  the three preview documents under `docs/product/`, and
  `web/src/app/preview/page.tsx`, `states.tsx`, `preview.module.css`.
- **Forbidden paths:** every production surface, the `/preview` route and
  layout themselves, the preview tests, the middleware allowlist, the
  `PLANNER_UI_PREVIEW` flag, database migrations, and other worktrees.

## Deliverables

1. `TableView`, `GraphView`, `GraphNode`, `CanvasView`, `WorkspaceTabs` and
   `ShareState` removed, with the state and controls that reached them.
2. Their CSS removed, without touching rules the surviving screens share and
   without removing classes reached by dynamic lookup.
3. The three preview documents updated to say the captures are now the only
   record.

## Acceptance

- No production file changes.
- `/preview` still renders, still passes its own accessibility check, and still
  passes the frame-isolation tests.
- `npm run agent:check` and `npm test` pass under Node 24.21.0.

## Handoff

`.agents/handoffs/preview-deferred-screens.md`
