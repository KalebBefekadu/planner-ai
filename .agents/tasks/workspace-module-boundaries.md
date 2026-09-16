# Workspace Module Boundaries Task

- **Goal:** begin EH-03 by lifting the pure state transitions out of the two
  largest Workspace components so they can be tested directly.
- **Owner:** Codex lead
- **Branch:** `codex/workspace-module-boundaries`
- **Base:** `codex/invite-capability`.
- **Dependencies:** the existing pure Note modules (`note-paths`,
  `sibling-order`, `markdown/editing`), which set the shape these follow.
- **Writable paths:** `.agents/ACTIVE.md`,
  `.agents/tasks/workspace-module-boundaries.md`, the matching handoff,
  `web/src/lib/notes/note-tree.ts`,
  `web/src/lib/notes/attachment-display.ts`,
  `web/src/lib/notes/collapsed-branches.ts`,
  `web/src/lib/planner/horizon-labels.ts`,
  `web/src/lib/markdown/editing.ts`,
  `web/src/components/notes-workspace.tsx`,
  `web/src/components/planner-workspace.tsx`, `web/src/app/actions.ts`, and the
  matching unit tests.
- **Forbidden paths:** `/preview` (see below), database migrations, generated
  types, production configuration/data/credentials, deployment settings, and
  other worktrees.

## What is deliberately not in scope

EH-03 also asks for the superseded Preview implementation to be removed. The
roadmap gates that: *"Delete `/preview` only after both Workspace and Planner
pass their MVP workflow and parity gates."* Neither gate is recorded as passed
in `docs/status.md`, which still lists closing those parity gaps as open work.
`/preview` is 3,794 lines across three files and is the second largest module
in the repository, so removing it is the largest single win available under
EH-03 — and it is not this contract's to take.

Server Actions and Route Handlers becoming thin adapters is the other half of
EH-03 and is a larger change than one contract. One piece of it is done here:
`GoalType` moves out of `@/app/actions` into the domain module, because a
domain fact does not belong in the Server Action that happens to return it.

## Deliverables

1. `note-tree.ts`: the tree derivations the Notes Workspace renders from --
   grouping children, the ancestors of the open page, which branches render
   open, what toggling one does, which moves the controls may offer, and where
   a Note may be filed.
2. `collapsed-branches.ts` and `attachment-display.ts`: the per-browser view
   preference store and the claims made about an attached file.
3. `insertMarkdownTable` joins its two siblings in `markdown/editing.ts`.
4. `planner/horizon-labels.ts`: the horizon ladder, its labels, and the period
   range labels, with `GoalType` moved to it and re-exported from
   `@/app/actions` so no caller changes.
5. Unit coverage for all of it, including the cases that are invisible in a
   render: a parent chain pointing at a filtered-out Note, a cycle, and period
   labels read from a timezone behind UTC.

## Acceptance

- No behaviour changes. Every function is moved rather than rewritten.
- `npm run agent:check`, `npm test`, `npm run build`, and the Notes and Planner
  browser specs pass under Node 24.21.0.

## Verification

Run from `web/` with Node 24.21.0:

```bash
npm ci
npm run agent:check
npm test
npm run build
npx playwright test tests/e2e/journey-notes.spec.ts tests/e2e/journey-planner.spec.ts tests/e2e/notes-at-scale.spec.ts --project=chromium
```

## Handoff

`.agents/handoffs/workspace-module-boundaries.md`
