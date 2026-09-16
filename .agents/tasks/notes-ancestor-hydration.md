# Notes Ancestor Hydration Task

- **Goal:** audit `notes/actions.ts` against EH-03's adapter rule and extract
  whatever is genuinely domain logic — no more than that.
- **Owner:** Codex lead
- **Branch:** `codex/notes-actions-view-model`
- **Base:** `codex/actions-as-adapters` at `ea0b657`.
- **Writable paths:** `.agents/ACTIVE.md`, this contract, the matching handoff,
  `web/src/lib/notes/ancestor-hydration.ts`,
  `web/src/app/notes/actions.ts`, and
  `web/tests/unit/note-ancestor-hydration.test.ts`.
- **Forbidden paths:** the Operation handlers, other action files, database
  migrations, production configuration/data/credentials, and other worktrees.

## Deliverables

1. An audit that says what does **not** need changing as clearly as what does.
2. The search ancestor walk extracted, with the round trips left in the action.
3. Coverage for its termination, its per-level batching, and its marking.

## Acceptance

- No behaviour change.
- `npm run agent:check`, `npm test`, `npm run build` and the search, notes and
  at-scale browser journeys pass under Node 24.21.0.

## Handoff

`.agents/handoffs/notes-ancestor-hydration.md`
