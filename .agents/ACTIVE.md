# Active Agent Work

Roadmap stage: **2 - Workspace, Planner And Delivery Hardening**

## Merged: the engineering improvement program

The stack is merged into `integration/dogfood`. Sixteen slices, 59 commits.

Three decisions the owner delegated, and what was decided:

1. **Merging.** Worker agents may now merge work they have verified.
   `AGENTS.md` and `CLAUDE.md` are changed to say so, with the condition that
   it holds only while the handoff stays honest.
2. **Account deletion retries.** Not capped. A capped deletion stops retrying
   and leaves the person's data in place, which is a permanent silent failure
   rather than an ongoing one. What changes after five attempts is the
   reporting: the lifecycle run finishes `failed` with `deletion_stalled`, so a
   stalled request is visible in the mechanism that already exists.
3. **`/preview`.** It stays, recorded as an accepted cost. The six deferred
   screens are gone and their design is preserved; what remains is six unbuilt
   MVP patterns under WS-01 to WS-04. Building five feature tickets to justify
   deleting a reference implementation is the wrong reason to build them.

## `main` is synced

`main` and `integration/dogfood` are the same tree, and both are green.
`main` at `cda4fa5` passes `application`, `browser` and `database`, plus Secret
Scan. The sync went through #262 (195 commits from integration, plus `LICENSE`,
which `main` had never carried despite the repository being public).

Two things about that merge are worth knowing before the next one:

- **`README.md` was the only conflict in 344 files, and it was resolved in
  favour of `main`.** Both branches edited it on 2026-09-09: integration added
  a licensing section at 09:44, and `main` was trimmed by hand to a single line
  at 10:16. The later edit is the owner's and it is the public face of a public
  repository, so the merge was not allowed to reverse it. `main` keeps its
  one-line README; integration keeps its own. A future sync will hit this
  conflict again -- resolve it the same way unless the owner says otherwise.
- **#239 was closed rather than merged.** It predated the program merge by 63
  commits, and its branch still has four commits unpushed in the local worktree
  at `.worktrees/release-main-sync`. Nothing was lost; #262 carries it all.

Merging to `main` applies no migrations. The only automation on the branch is
`ci.yml` and `secret-scan.yml`; Vercel builds the application and nothing
touches the production database.

## PL-11 is merged, mostly as a no-op

#185 sat as a draft since 2026-09-09 behind one stated condition -- its browser
tests had never been run -- and GitHub Actions was unavailable on billing
grounds at the time. The repository went public on 2026-09-09, which made
Actions free, and the condition quietly stopped applying. Nobody went back.

The tests were run. 26 passed on both projects. Merging it then found that
integration had reached the same design independently
(`lib/reviews/completion-intent.ts`), so every conflict was resolved in
integration's favour -- `getWeeklyReview` had been rewritten wholesale and
reconstructing a 127-commit-old branch's edits on top of it would have risked a
core surface for nothing.

One thing survived, and it was a live defect: the idempotency key was bound to
the submission intent alone. The intent is minted once per mount and cleared
only on success, so a *failed* submission leaves it in place -- and a correction
typed afterwards travels under the failed attempt's intent, replays its receipt,
and is silently discarded. The key is now bound to the payload as well. With the
fingerprint removed, all three period tests fail on exactly that assertion.

The lesson worth keeping: a hold written for a reason that later expires does
not expire with it. Read the reason, not the label.

## Open, and owner-facing

- ~~The rich editor silently discards task completion on a phone.~~ Fixed. It
  was the application, not Playwright's touch emulation: the task item commits
  its tick with `chain().focus().command(...)`, and `focus()` is synchronous on
  a touch device where it is deferred to an animation frame on a desktop. The
  synchronous focus dispatches a selection transaction in the middle of the
  chain, so the chain's own transaction is built on a state that no longer
  exists and ProseMirror rejects it -- "Applying a mismatched transaction" in
  the console, a tick on screen, and `- [ ]` still in the Markdown. Cancelling
  `pointerdown` over the checkbox keeps focus in the editor, which is what a
  desktop already does by cancelling `mousedown`, and `focus()` then has
  nothing to do.
- ~~`mobile-chromium` running only after merge is the gap that hid it.~~ Both
  browser projects now run on pull requests. The comment in `ci.yml` justified
  the saving by saying mobile had never caught a defect first; the first
  post-merge run after that comment was written is the run that falsified it.
- Two browser journeys are flaky, and both retried green in the run that
  merged the task-completion fix (#260):
  `journey-notes.spec.ts:666` "typing and immediately opening another Note does
  not lose the last edit" on `chromium`, and `journey-notes.spec.ts:893`
  "a favourite Note stays reachable without the tree and survives reload" on
  `mobile-chromium`. Neither is related to that fix. The first guards a defect
  that has actually shipped before -- a Notes editor discarding the last edit --
  so a retry hiding it is the wrong kind of quiet. Worth a task; a journey that
  only passes on the second attempt is not evidence that the journey works.
- A completed **weekly** review still reopens as an editable form, while a
  completed month or quarter reopens as a saved record. PL-11 (#185) built the
  weekly saved-record view, and it was deliberately not carried across when that
  branch was merged: `getWeeklyReview` had been rewritten underneath it by the
  weekly initiative ritual, and rebuilding the UI on the new shape is separate
  work rather than a merge resolution. The server still refuses a second review
  of a reviewed period, so nothing is lost -- but the week is the one period
  that answers a second completion with an error instead of by showing what is
  already saved. The original implementation is in #185's history if it helps.
- `src/app/actions.ts` is the last of the three large action files. Audit it
  before assuming it needs splitting; the lesson from `notes/actions.ts` is
  that length and shape are different questions.
- EH-05 waits on the personal MVP gate. EH-06's tracing and SLO halves want a
  running system with real traffic.

## CI runs again, and integration is green

The Actions billing block is cleared. The repository was made public on
2026-09-09, which makes Actions free, and secret scanning with push protection
free along with it. A red check is a test result again. Read it as one.

`integration/dogfood` is green. The deadlock recorded here before -- `browser`
failing on an Axe contrast ratio and `database` failing on checked-in Supabase
types, each fixed only by the pull request the other made unmergeable -- was
broken by #198 and #201 and is history.

The habit that section taught is still worth keeping: when your pull request
goes red, check whether integration fails the same job before you go looking
in your own branch.

## Local verification

Still worth running before handoff -- it is seconds against minutes, and CI
runs one worker.

| CI job        | Local substitute                                     | Notes                                                                                                                         |
| ------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `application` | `cd web && npm run agent:check` and `npx vitest run` | Seconds. Run vitest from `web/`; from the parent, relative paths in tests break and invent failures.                          |
| `database`    | `npx supabase db reset` then `npx supabase test db`  | Needs Docker. The CLI is a devDependency, so `npx supabase`, not a global binary.                                             |
| `browser`     | `npx playwright test`                                | Needs `web/.env.local`. Generate a throwaway one from `npx supabase status -o json`; agents may not read or copy the owner's. Runs both projects, as CI now does; `--project=chromium` alone will not see a touch-only defect. |

State what you actually ran and what you could not. A check nobody ran is not a
passing check.

### One local stack, one worker at a time

Every worktree shares a single local Supabase project named `planner-ai`, so
`supabase start`, `db reset` and `test db` are a contended resource. Two agents
running them at once tore the stack down mid-run and left orphaned containers
that made every later `supabase start` fail on a name conflict. Recover with
`docker rm -f $(docker ps -aq --filter name=planner-ai)` and start again.

This is not only a flakiness problem. Because the stack is shared,
`npm run types:generate` captures whatever migrations happen to be applied at
that moment. That is how a `favorited_at` column entered the checked-in types
with **no migration on integration creating it**, which is the `database`
failure above. Regenerate types only against a clean `supabase db reset`, and
never on a branch whose migrations are not the ones applied.

### Never `npm ci` by copying

Copying `node_modules` from a sibling worktree carries symlinks that resolve
outside the destination root, and the install reports
`Symlink [project]/node_modules is invalid`. Always `npm ci`.

### Failure modes worth knowing

- **`plan(N)` drift.** Four separate suites declared a plan smaller than the
  number of assertions they made, and pgTAP reports the whole file as failing
  even when every assertion passes. Count the assertions before handoff.
- **Conflict error codes.** A function may `raise` SQLSTATE `40001`, but the UI
  gateway deliberately translates that to `P0001`, because PostgREST turns
  `40001` into a 504 and discards the message. Assert the translated code, as
  every existing conflict test does.
- **Migration numbering after a rebase.** Integration is at `20260909170000`.
  A branch cut earlier commonly numbers its migration `20260909140000`, which
  now sorts _before_ migrations already applied -- a migration inserting itself
  into history that has already run. Renumber forward when you rebase, and do
  not hard-code a migration timestamp in a test; find the file by name suffix,
  because renumbering is routine.
- **A clean rebase is not a safe rebase.** Two branches merged without conflict
  and still broke things: one duplicated a `disabled` prop that integration had
  already added, and taking `operations/index.ts` wholesale from an older
  branch silently reverted `note.import-cancel.v1`, which had landed after that
  branch was cut. Read both sides of a file you take whole.

## Duplicate work is the main hazard

Five agents worked in parallel without a shared queue and produced several
independent implementations of the same ticket. Three pull requests were closed
as superseded: **#188** (PL-11, both halves already on integration), **#192**
(IM-02, a second complete link resolver -- it merged _cleanly_, which is worse
than conflicting), and **#184** (WS-07, the earlier draft of what became #195).
**#189** lost two of its three halves the same way.

Before starting, check whether the behaviour already exists on integration
under a different filename. Compare behaviour, not names.

## Open pull requests

All target `integration/dogfood`. Workers never merge their own work.

| PR   | Ticket                           | Branch                             | State                                                                          |
| ---- | -------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| #201 | Regenerated Supabase types       | `claude/regenerate-types`          | **Merge first.** Fixes `database` everywhere.                                  |
| #198 | IM-08 export scope               | `claude/im-08-export-scope`        | **Merge second.** Fixes `browser` everywhere.                                  |
| #200 | Licence                          | `claude/proprietary-notice`        | Clean.                                                                         |
| #191 | WS-03 document appearance        | `claude/ws-03-document-appearance` | Rebased, migration renumbered `...190000`.                                     |
| #189 | IM-05 import preview retention   | `claude/im-06-import-lifecycle`    | Cron approved by owner 2026-09-09.                                             |
| #199 | UI mobile review submission      | `claude/ui-05-mobile-review`       | Rebased.                                                                       |
| #182 | AI-03 pending state              | `claude/ai-03-approve-pending`     | Headline change already merged; the React test infrastructure is what remains. |
| #203 | WS-02 consolidated               | `claude/ws-02-consolidated`        | Draft. Supersedes #190 and #196.                                               |
| #190 | WS-02 organization               | `claude/ws-02-organization`        | Superseded by #203.                                                            |
| #196 | WS-02 favourites                 | `claude/ws-02-favorites`           | Draft. Superseded by #203.                                                     |
| #185 | PL-11 review intent, client side | `codex/pl-11-review-intent`        | Draft, conflicting.                                                            |
| #183 | This document                    | `claude/coordination-refresh`      | -                                                                              |

Ordering and overlap:

- **#201 then #198, before anything else.** See the deadlock above.
- **#203 must not merge until its types are regenerated**, after #201. It
  typechecks today only because the phantom `favorited_at` is still in the
  checked-in types; once #201 removes it, `notes/actions.ts` stops compiling
  until the types are regenerated against a clean reset. Its migration and its
  types have to land together or the drift returns.
- **#203's pgTAP suite and its three journeys are unexecuted**, not passing --
  the shared stack was reserved elsewhere when it was built.
- **#191 and #203** both change `notes-workspace.tsx`, `notes/actions.ts` and
  `globals.css`. The second to merge needs a rebase.

## Merged since this document was last true

#178 AI-01, #179 ON-01, #180 WS-05, #181 IM-04, #187 PL-11 monthly recurrence,
#194 PL-12, #195 WS-07, #197 IM-02.

These were rebase-merged, so a branch stacked on one of them will not find its
parent commit as an ancestor: rebase with `--onto integration/dogfood
<old-parent>` rather than a plain rebase.

## Integration

- Owner: Codex lead.
- Branch: `integration/dogfood`.
- Next: land #201 and #198 to get a trustworthy signal, sequence the rest, then
  reassess UI-03 (#140), which finishes the Preview extraction and removes the
  duplicate application.
