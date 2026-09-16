# Notes Ancestor Hydration Handoff

- **Task:** `.agents/tasks/notes-ancestor-hydration.md`
- **Branch:** `codex/notes-actions-view-model`
- **Base:** `codex/actions-as-adapters` at `ea0b657`

Second slice of EH-03's Server Actions bullet. **Much smaller than the file's
size suggests**, and the reason why is the useful part of this handoff.

## What the audit found: most of this file is already right

`src/app/notes/actions.ts` is 868 lines, which reads like a target. It mostly
is not one.

- **Twenty `executeOperation` calls.** Every mutation already goes through an
  Operation. `moveNoteWithinParent` is textbook: read the Note, read its
  siblings, call the already-extracted `nextSiblingMove`, handle its three
  outcomes, execute. There is nothing in it to pull out.
- **`getNoteKnowledgeContext` is 168 lines of translation**, not domain logic:
  nine queries and nine row-to-view mappers. Extracting it would produce tests
  asserting that `link.id` becomes `id`, which is testing the compiler.
  Translation is what EH-03 says a Server Action should be doing, so it is left
  alone deliberately.

Saying that plainly matters more than producing a large diff. A file being long
is not the same as a file being in the wrong shape.

## The one piece that was real

`getNotes` hydrates a search result's ancestors. Searching narrows the Note list
to matches, so a match filed two levels down arrives with a parent id pointing
at something the query did not return — and without its ancestors it has no
path to show and, once opened, nothing to name. That is precisely the case a
search is for.

The walk goes a level at a time, one round trip per level of depth rather than
one per ancestor. Its termination is not obvious: it relies on a Note only ever
being asked for while absent, so absorbing it removes it from every future
answer. A cycle in the parent links therefore ends after one lap without a
separate guard.

**That property had no test**, and could not have one: the loop is a `while`
around a network call inside a Server Action.

`web/src/lib/notes/ancestor-hydration.ts` now holds `missingParentIds`,
`absorbAncestorLevel` and `markMatches`. The round trips stay in the action.

## Coverage added

11 tests, including:

- a level of siblings sharing one parent asks for it **once**, not once per
  child, which is the whole point of walking by level;
- a cycle of two ends after one lap, and a cycle of three ends after two;
- hydrated ancestors come back **unmarked**, so the tree can show them while a
  result list ignores them and neither has to reconstruct the distinction;
- marking does not mutate the notes it was given.

## Files changed

- `.agents/ACTIVE.md`, the task and this handoff
- `web/src/lib/notes/ancestor-hydration.ts` (new)
- `web/src/app/notes/actions.ts`
- `web/tests/unit/note-ancestor-hydration.test.ts` (new)

## Verification

Run in `web/` with Node 24.21.0:

- `npm run agent:check` — passed.
- `npm test` — passed; 90 files, 1,046 tests, up from 89 and 1,035.
- `npm run build` — passed.
- `npx playwright test journey-search, journey-notes, notes-at-scale` —
  39 passed, including a vault past the PostgREST row cap, which is the case
  the paging and the hydration walk exist for.

## Risks and follow-up

- `src/app/actions.ts` at 992 lines is the last of the three and is untouched.
  It should be audited the same way rather than assumed to need splitting: the
  lesson from this file is that length and shape are different questions.
- The extracted functions mutate the map they are given, which is what makes
  the walk terminate. That is documented on `absorbAncestorLevel` and pinned by
  the cycle tests, but it is the one thing about this module that would
  surprise a reader expecting pure functions.
