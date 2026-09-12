# Active Agent Work

Roadmap stage: **2 - Workspace, Planner And Delivery Hardening**

## CI runs again, and integration itself is red

The Actions billing block is cleared. The repository was made public on
2026-09-09, which makes Actions free, and secret scanning with push protection
free along with it. A red check is a test result again. Read it as one.

**But `integration/dogfood` currently fails two of its own three jobs**, so
every branch inherits those failures and a red check on your PR may not be
about your work. Check whether integration fails the same job before
investigating your own branch.

| Job           | State on integration | Cause                                                                         |
| ------------- | -------------------- | ----------------------------------------------------------------------------- |
| `application` | passing              | -                                                                             |
| `browser`     | **failing**          | Axe contrast, 3.47:1 on `.export-scope-note` in Data settings. Fixed by #198. |
| `database`    | **failing**          | Checked-in Supabase types do not describe the migrations. Fixed by #201.      |

Those two must merge before any other result is trustworthy. They are a
deadlock: each fixes the only job the other fails, so neither looks green
alone.

## Local verification

Still worth running before handoff -- it is seconds against minutes, and CI
runs one worker.

| CI job        | Local substitute                                     | Notes                                                                                                                         |
| ------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `application` | `cd web && npm run agent:check` and `npx vitest run` | Seconds. Run vitest from `web/`; from the parent, relative paths in tests break and invent failures.                          |
| `database`    | `npx supabase db reset` then `npx supabase test db`  | Needs Docker. The CLI is a devDependency, so `npx supabase`, not a global binary.                                             |
| `browser`     | `npx playwright test`                                | Needs `web/.env.local`. Generate a throwaway one from `npx supabase status -o json`; agents may not read or copy the owner's. |

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
