# Server Actions As Adapters Handoff

- **Task:** `.agents/tasks/actions-as-adapters.md`
- **Branch:** `codex/actions-as-adapters`
- **Base:** `codex/operation-owning-domain` at `1a90f96`

First slice of EH-03's second bullet, which I had been treating as blocked when
it was only deferred.

## A correction

In three handoffs I described the remaining work as needing a decision,
production traffic, or a gate. That was true of `/preview` increment 3, EH-06's
dashboards and EH-05 — it was **not** true of this:

> Keep Server Actions and Route Handlers as authentication, validation, and
> translation adapters rather than domain implementations.

Nothing blocked it. I had deferred it as "its own contract" and then started
reporting my own deferral as a blocker. It is not.

## What the audit found

The mutations already obey the rule. `review/actions.ts` routes every write
through `executeOperation` — four of them — so no domain logic lives there.

**The reads did not.** `getWeeklyReviewData` was ~290 lines interleaving eight
queries with the reasoning that turns their rows into a screen: deduplicating
two reads into one list, walking the Goal tree for a direction chain, reducing
completions to one per Goal, counting quiet checkpoints. None of it could be
asked a question without a database and a workspace behind it.

One of those functions, `directionChainFor`, is the same bounded-ancestor-walk
with a cycle guard that #247 extracted and tested for the Notes tree. The same
shape of logic, trapped the same way, two files apart.

## What changes

**No behaviour.** Every function is moved rather than rewritten, and the
comments explaining why each rule exists move with it.

`web/src/lib/reviews/weekly-view-model.ts` now holds `dedupeActions`,
`goalIdsInWeek`, `lastCompletionByGoal`, `buildParentIndex`, `directionChain`,
`buildWeeklyGoals` and `finishedSinceWindow`. The queries stay in the action,
because fetching is the part that genuinely needs a session.

`review/actions.ts` 730 → 676 lines.

## Coverage added

20 tests over cases that were previously unreachable:

- an Action returned by **both** reads appears once — a duplicate on screen is a
  question the person cannot answer, because the Operation refuses the second
  decision as `duplicate_review_action`;
- a Goal that has **never** closed anything is quiet for every checkpoint on
  record, not for zero of them — reporting zero would hide exactly the project
  worth pausing;
- a cycle in the Goal tree terminates rather than hanging the page;
- a parent id pointing outside the tree stops the walk;
- the finished-list window falls back to the week itself **and says that it
  did**, because a screen reading "since your last review" when there has never
  been one is telling the person something untrue.

## Files changed

- `.agents/ACTIVE.md`, the task and this handoff
- `web/src/lib/reviews/weekly-view-model.ts` (new)
- `web/src/app/review/actions.ts`
- `web/tests/unit/weekly-view-model.test.ts` (new)

## Verification

Run in `web/` with Node 24.21.0:

- `npm run agent:check` — passed.
- `npm test` — passed; 89 files, 1,035 tests, up from 88 and 1,015.
- `npm run build` — passed.
- `npx playwright test journey-review, mobile-review-reachability` — 12 passed,
  including completing a week, undoing it, completing it again, and submitting
  a quarterly review from a phone viewport.

## Risks and follow-up

- `getPeriodReviewData` in the same file (~113 lines) has the same shape and is
  untouched. It was left because this slice is already a self-contained piece
  and the weekly path is the one with the interesting edge cases; the period
  path is mostly row mapping.
- **Two larger files remain**: `src/app/actions.ts` at 992 lines and
  `src/app/notes/actions.ts` at 868. Both deserve the same treatment and
  neither is blocked — the same correction applies to them as to this one.
- The extracted functions take row shapes typed structurally rather than from
  the generated Supabase types, because the action's queries use PostgREST
  embedding whose result types do not survive the `select` string. The action
  casts once at the boundary. Deriving these from the generated types would be
  better and is a separate piece of work.
