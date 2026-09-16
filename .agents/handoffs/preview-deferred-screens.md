# Preview Deferred Screens Handoff

- **Task:** `.agents/tasks/preview-deferred-screens.md`
- **Branch:** `codex/remove-preview`
- **Base:** `codex/critical-path-coverage` at `bdc9162`

Increment 2 of the `/preview` retirement plan in
`docs/product/preview-extraction-audit.md`. **Not increment 5.** The route stays.

## Why this is not the whole deletion

The owner asked for `/preview` to be deleted outright on the basis that its
parity gates were met. Reading the repository's own gate documents before
deleting showed they are not, and specifically enough to be worth stopping for:

`preview-inventory.md` states `/preview` may not be deleted while any row is
`open`, and eleven are. `preview-extraction-audit.md` sequences the retirement
into five increments where deletion is the last, and its preconditions are
increments 1–4. **Increment 3 is six unbuilt features** — shell quick capture
with voice (WS-04), conflict recovery (WS-01), inline `@`-mention (WS-02),
context-panel auto-open (WS-03), search scope filter (WS-02) — each of which
"keeps its Preview screen alive as the reference until its port lands".
Increment 4 moves two e2e tests off `/preview` and is explicitly gated on 3
"so that no rewritten test loses coverage of a pattern that only Preview still
demonstrates".

Increment 2's own precondition — increment 1, the reference captures — **is**
met. That is what this branch does.

Correction while I am here: I had been reporting `/preview` as 3,794 lines in
earlier handoffs and pull requests. It was 10,111. I had counted three `.tsx`
files and missed a 4,924-line CSS module and five smaller components.

## Behavior changed

`/preview` no longer offers the four workspace view modes, the share dialog, or
the block-control gutter. Everything else about the route is unchanged, and no
production surface is touched at all.

Removed: `TableView`, `GraphView`, `GraphNode`, `CanvasView`, `WorkspaceTabs`,
`ShareState`, the `WorkspaceMode` state that switched between them, the sidebar
`Views` section, the top-bar `Share` button, and 584 lines of their CSS.

996 lines removed. `/preview` is 10,111 → 9,115.

## What makes this safe

The six patterns are recorded in `docs/product/preview-reference/`: desktop and
mobile captures plus a written specification "detailed enough to rebuild the
screen without the image". That directory exists precisely so these screens
could be deleted, and all three documents now say so.

## Two things worth knowing about the CSS

A dead-class sweep found 73 unreferenced classes. **Only 53 of them were
actually dead.** `opRisk*`, `opKind*`, `notificationIcon*`, the align status
classes and `yellow` are reached through `styles[\`opRisk${risk}\`]`-style
dynamic lookups that no static search can see. Removing them would have broken
the preview silently, in exactly the way the storage-policy defects broke
uploads silently.

Five rules grouped a removed class with live ones — `.databaseView, .homeView,
.searchView…`. Those had the dead member dropped rather than the rule, because
deleting the rule would have taken the home, search and settings surfaces with
it.

## Files changed

- `.agents/ACTIVE.md`, the task and this handoff
- `docs/product/preview-extraction-audit.md` — increment 2 marked complete
- `docs/product/preview-inventory.md` — the deferred rows now point at the captures
- `docs/product/preview-reference/README.md` — the record is now load-bearing
- `web/src/app/preview/page.tsx`, `states.tsx`, `preview.module.css`

## Verification

Run in `web/` with Node 24.21.0:

- `npm run agent:check` — passed, no unused imports left behind.
- `npm test` — passed; 87 files, 1,006 tests, unchanged.
- `npx playwright test preview-frame, accessibility, auth-boundary
  --project=chromium` — 25 passed, including `/preview`'s own WCAG A/AA check
  and the frame-isolation tests.

## Risks and follow-up

- **Increment 5 remains blocked on real product work**, not on cleanup. Six
  features under five tickets stand between here and deleting the route.
- `preview-isolation.test.ts` and the `--v2-*` alias test in
  `design-tokens.test.ts` still read the preview sources, so they continue to
  pass and continue to be meaningful. They are increment 5's problem.
- The CSS still defines `--v2-*` aliases that nothing uses now. They are
  harmless, the alias test only checks used-implies-defined, and pruning them
  is not worth the risk of touching a scale the surviving screens share.
