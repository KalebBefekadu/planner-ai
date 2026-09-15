# Workspace Module Boundaries Handoff

- **Task:** `.agents/tasks/workspace-module-boundaries.md`
- **Branch:** `codex/workspace-module-boundaries`
- **Base:** `codex/invite-capability` at `15ce786`

First slice of EH-03. It does not close the outcome; see what is left below.

## Behavior changed

None. Every function is moved rather than rewritten, and the comments
explaining why each rule exists move with it.

## What moved, and why it matters

The answers the Notes tree renders — which branches are open, which moves the
controls may offer, where a Note may be filed — lived inside a 2,147-line
client component. The only way to ask "does an unparented Note offer Outdent?"
was to render the whole Workspace and look, which is why none of it had a test.

- `web/src/lib/notes/note-tree.ts` — grouping children by parent, the ancestors
  of the open page, which branches render open, what toggling one does, the
  available moves, and the filing candidates.
- `web/src/lib/notes/collapsed-branches.ts` — the per-browser view preference
  store behind `useSyncExternalStore`.
- `web/src/lib/notes/attachment-display.ts` — what a person is told about an
  attached file. These read as presentation but each is a claim about a stored
  object, which is how "Security review pending" once came to be shown forever.
- `web/src/lib/markdown/editing.ts` — `insertMarkdownTable` joins the two
  siblings that were already extracted.
- `web/src/lib/planner/horizon-labels.ts` — the horizon ladder, its labels, and
  the period range labels.

`GoalType` moves out of `@/app/actions` into the planner domain module and is
re-exported from there, so no caller changes. A domain fact does not belong in
the Server Action that happens to return it, which is the other half of what
EH-03 asks.

`notes-workspace.tsx` 2,147 → 1,999 lines. `planner-workspace.tsx` 1,338 →
1,303.

## Coverage added

49 tests across three new files, including the three cases that are easy to get
wrong and invisible in a render:

- a parent chain pointing at a Note filtered out by a search, which must stop
  rather than follow a dangling id;
- a cycle, which must terminate rather than hang the tree;
- a period label read from a timezone behind UTC, where a date-only bound
  parsed as a timestamp renders the day before — a week starting Sunday the
  14th labelled as starting Saturday the 13th for most of the Americas.

## Files changed

- `.agents/ACTIVE.md`
- `.agents/tasks/workspace-module-boundaries.md`
- `.agents/handoffs/workspace-module-boundaries.md`
- `web/src/lib/notes/note-tree.ts` (new)
- `web/src/lib/notes/collapsed-branches.ts` (new)
- `web/src/lib/notes/attachment-display.ts` (new)
- `web/src/lib/planner/horizon-labels.ts` (new)
- `web/src/lib/markdown/editing.ts`
- `web/src/components/notes-workspace.tsx`
- `web/src/components/planner-workspace.tsx`
- `web/src/app/actions.ts`
- `web/tests/unit/note-tree.test.ts` (new)
- `web/tests/unit/note-attachment-display.test.ts` (new)
- `web/tests/unit/planner-horizon-labels.test.ts` (new)
- `web/tests/unit/markdown-editing.test.ts`

## Verification

Run in `web/` with Node 24.21.0:

- `npm ci` — passed.
- `npm run agent:check` — passed.
- `npm test` — passed; 84 files, 976 tests, up from 81 and 927.
- `npm run test:db` — passed; 70 files, 1,280 assertions.
- `npm run build` — passed. Run deliberately, because moving `GoalType` means a
  `'use server'` module now re-exports a type, and `tsc --noEmit` does not
  check what Next's Server Action validation checks.
- `npx playwright test tests/e2e/journey-notes.spec.ts
  tests/e2e/journey-planner.spec.ts tests/e2e/notes-at-scale.spec.ts
  --project=chromium` — passed; 47 tests, against a throwaway local-stack
  `.env.local` generated from `npx supabase status` and deleted afterwards.

## Risks and follow-up

- One browser test, "the rich editor writes back to the same portable Markdown
  Note", failed once under four parallel workers and passed alone and on a
  clean re-run of all three specs. It loads the editor as a dynamic chunk, so
  it is most likely contention rather than a regression — but it is a flake
  worth watching rather than one to dismiss.
- **EH-03 is not closed.** Two larger pieces remain, and the bigger one is
  blocked rather than unfinished:
  - `/preview` is 3,794 lines across three files, the second largest module in
    the repository, and removing it is the single biggest win available under
    this outcome. The roadmap gates it: *"Delete `/preview` only after both
    Workspace and Planner pass their MVP workflow and parity gates."* Neither
    gate is recorded as passed in `docs/status.md`. **That is the decision to
    make next, and it is not an engineering decision.** Either record the
    parity gates as met and delete it, or accept that a second product
    implementation stays in the tree.
  - Server Actions and Route Handlers are still domain implementations rather
    than adapters — `src/app/actions.ts` is 991 lines, `notes/actions.ts` 868,
    `review/actions.ts` 730. `GoalType` moving is one piece of that; the rest
    is its own contract.
- What is left inside `notes-workspace.tsx` is mostly the autosave and draft
  state machine: an in-flight save, a queued draft, a conflict capture, and a
  version ref, spread across six refs and a callback. It is the highest-risk
  logic in the file and still has no direct test. It is also the piece a split
  would change the shape of rather than move, so it wants its own contract and
  a deliberate decision about what the state machine is.
