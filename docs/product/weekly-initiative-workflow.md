# The Weekly Initiative Workflow

Status: **built, not yet merged or accepted into [the roadmap](../roadmap.md).**
Every step in [the build order](#build-order) has shipped on a worker branch;
the integration agent reviews and merges, and the roadmap remains the execution
authority on delivery order. There are eight steps rather than the four this
document originally scoped. Each factual claim below was cited to a file and line in this repository
when it was written. Where an earlier draft of this document was wrong, or where
building it corrected the plan, the correction is marked next to the claim it
replaces.

## Contents

1. [The objective](#the-objective)
2. [The ritual being replaced](#the-ritual-being-replaced)
3. [The ten minutes, decomposed](#the-ten-minutes-decomposed)
4. [Where this design disagrees with the ask](#where-this-design-disagrees-with-the-ask)
5. [The system as it stands](#the-system-as-it-stands)
6. [The five gaps](#the-five-gaps)
7. [The features asked for](#the-features-asked-for)
8. [The weekly pass](#the-weekly-pass)
9. [The screen](#the-screen)
10. [Does this actually work?](#does-this-actually-work)
11. [Build order](#build-order)
12. [Risks, and how each is contained](#risks-and-how-each-is-contained)
13. [Open questions, with a recommendation on each](#open-questions-with-a-recommendation-on-each)
14. [Invariants](#invariants)

## The objective

**The owner must be able to see what they did this week, and decide what next
week is for, without retyping anything.**

That is the whole feature. Two sentences, and everything in this document exists
to serve them.

It is not new scope. [The roadmap](../roadmap.md) makes it MVP outcome 4 --
_"capture a thought, connect an Action to a Goal, plan Today and This Week,
complete or defer work, and finish Weekly Review"_ -- and Stage 1, the Daily
Planner Loop, is the active stage. The roadmap also states plainly: _"Do not
build deferred frontier scope while a personal-MVP gate remains open."_ This
design must therefore be read as **finishing Stage 1**, not as a feature
alongside it. Anything here that cannot be justified that way should be deferred.

There is a second reason it belongs now. The roadmap gates Notion replacement on
[MVP-01](https://github.com/KalebBefekadu/planner-ai/issues/115), an inventory of
_"the owner's actual workflows"_, and warns against assuming notes-only is
sufficient. The weekly initiative ritual **is** that inventory's most important
entry: it is the workflow the owner runs every week, in Notion, today. Designing
against it is how MVP-01 gets closed rather than assumed away.

Three failure modes would each make the feature worthless, and they are worth
naming before any design:

- **It costs more than ten minutes.** The current ritual is cheap. A replacement
  that asks for more decisions loses, however much better its data model is.
- **It stops working when AI is off.** Roadmap Stage 3 is explicit: AI
  _"is never required to complete"_ a core workflow. Every number on this screen
  must be computed from records.
- **It does not survive the owner falling behind.** Real weeks get skipped. A
  design that only works when every week is reviewed on time is a design for
  someone else.

## The ritual being replaced

Every week the owner creates a folder for each project or business they have
running, writes that week's tasks underneath it, checks them off as the week
goes, and cleans the whole thing up at the end of the week.

**Most of that work repeats.** The owner's own description of what they want is
to start each week from the previous one as a template, update what has moved,
and add what is new.

The exported structure -- rough notes rather than a specification -- looks like:

```
Weekly
  Urgent important tasks          <- a priority grouping, not a project
  TEK Systems - Amazon            <- an ongoing concern
    Wait for new start date
    Reach out to baily
      wait to hear back           <- depth 2
  1679
  Planner AI
  Real estate agent business
```

Three properties matter and are easy to lose:

1. **The container outlives the week.** "Real estate agent business" is not
   finished; it recurs every week with new work under it.
2. **Work nests**, and the nesting is how a task keeps its context ("wait to
   hear back" is meaningless on its own).
3. **Most of the list survives the week**, and rewriting it is manual labour.

## The ten minutes, decomposed

The ritual is one habit, but it is six distinct moments, and each one lands on a
different part of the product. Designing against the habit as a single lump is
how features like this end up as one giant screen that does everything badly.

| #   | Moment                                       | What the owner is doing                                | What must serve it                                 | State today                                        |
| --- | -------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------- |
| 1   | **Recall** -- "what did I do?"               | Reading back the week to feel it was not wasted        | A record of completions, grouped by project        | **Nothing.** The review reads only unfinished work |
| 2   | **Reconcile** -- "what is still open?"       | Scanning the surviving list, mostly agreeing with it   | The initiative's open list, with age               | Exists as a flat undifferentiated list             |
| 3   | **Prune** -- "this is never happening"       | Killing two or three things, with mild guilt           | A visible reason to kill, and a record of the kill | `dropped` + `drop_reason` exist; no prompt         |
| 4   | **Add** -- "and this came up"                | Typing three or four new lines under the right project | Fast entry, filed and nested in one gesture        | Exists, but not per-project and not nested         |
| 5   | **Aim** -- "what is next week actually for?" | Choosing the handful that matter                       | A small, capped commitment                         | Exists and is unused: the max-5 priority flag      |
| 6   | **Close** -- "done, put it away"             | Marking the week finished and leaving                  | One irreversible-feeling act, undoable             | `review.complete-weekly.v1` does exactly this      |

Read down the right column: **moments 1 and 5 are the ones the owner explicitly
asked for, and they are the two the product serves worst.** Moment 1 has no
implementation at all. Moment 5 has a complete, correct, tested implementation
that no screen ever surfaces properly.

That is the whole opportunity, and it reframes the work. This is not mostly a
build. It is mostly an **exposure** of machinery that already runs.

## Where this design disagrees with the ask

**Copying last week forward is the wrong mechanism, and it is worth saying so
before building it.**

The weekly re-creation is not part of the workflow. It is a workaround for
something Notion cannot do: a Notion page has no idea which of its tasks are
still open, so the only way to carry work is to copy it by hand. Rebuilding that
copy step inside a tool that already tracks task state would import the
workaround along with the ritual, and it costs something real.

Copying creates a **new record with a new identity**. "Reach out to baily" copied
into four consecutive weeks is four unrelated rows, and the single most useful
fact about it -- that it has survived four weeks untouched -- is destroyed by the
copying. That fact is the one that tells the owner a task is never going to
happen. Copying also duplicates every subtask beneath it, and splits a task's
history across records, so the Review can only ever describe one week rather than
the life of the work.

This is not a theoretical preference. **Planner AI already carries work, and
already records each carry.** When a weekly review resolves an Action as
`next_week`, the completion function moves that same Action into the following
week's horizon and writes a row to `action_schedule_history` with
`reason = 'rescheduled'` and the `review_id` that caused it
(`20260909161000_weekly_review_names_a_finished_week.sql:178`). A
`left_overdue` decision writes a row too, with that reason, and deliberately
does not move the Action at all.

Nothing reads any of it. `action_schedule_history` appears exactly once in the
application outside generated types: in the account export
(`web/src/app/api/export/route.ts:45`).

**But the history is the wrong source for the carry count anyway**, for a reason
that only becomes visible once this design is taken seriously. See
[Gap 4](#gap-4-the-age-of-open-work-is-invisible-and-the-obvious-fix-is-a-trap).

What "starting from last week" actually asks for decomposes into three different
things, which are better kept apart because they behave differently:

| What repeats                                                                        | What it really is | Where it lives                                                  |
| ----------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------- |
| Work still not finished                                                             | **carried**       | the same Action, untouched, with a carry count                  |
| Work that genuinely resets each period -- invoicing, a weekly review, an oil change | **recurring**     | `action_templates` (`cadence`, `next_occurrence_on`, `goal_id`) |
| The projects themselves                                                             | **standing**      | the initiative, which is an entity and never needs copying      |

All three already have somewhere to live. Rolled together into "copy last week"
they need new machinery and lose the distinction that makes the week readable:
what stalled, what came round again, and what is genuinely new.

**The week stops being a container and becomes a checkpoint.** The initiative
holds a living list; the weekly pass is where the owner marks what is done, drops
what is dead, and adds what is new. That is the same ten minutes, minus the
retyping.

### The one thing copying does better

A deliberate reset. Sometimes the right move is to declare weekly bankruptcy on a
stalled initiative and rewrite its list from scratch. That is worth an explicit
action -- clear what is open, with a reason recorded -- rather than a copy
mechanism used every week to get it.

### The counter-argument already in the code, and how it is answered

The existing review screen deliberately refuses to default any decision. The
comment is unusually direct (`web/src/components/weekly-review.tsx:19`):

> A decision nobody made is not a decision. The list starts unset so that closing
> the week requires saying what happens to each unfinished Action -- defaulting
> every row to "leave overdue" made silent rollover the easiest path through a
> screen whose whole claim is that it prevents one.

That reasoning is correct **under the current model**, and this design must not
casually undo it. When the week is the only container, silence really is
invisible: an Action that rolls over unremarked leaves no trace anywhere, and the
forced decision is the only thing standing between the owner and an infinitely
growing invisible backlog.

The resolution is not "defaults are fine after all". It is that **the guard
moves**. Once the carry count is on screen and escalates, rolling over is no
longer silent -- it is recorded, visible, and gets louder every week. The
deterrent survives; the per-item tax does not. Concretely:

- staying open is free and requires no interaction, **because the count is shown
  next to the item**;
- an item carried three weeks or more is surfaced for an explicit decision,
  exactly as every item is today;
- the week cannot be closed while any such item is undecided.

That preserves the invariant the original author was protecting -- no silent
rollover -- while removing the cost from the 90% of items where the owner's
answer is "yes, obviously, still doing that."

## The system as it stands

More is built than the feature needs. The problem is almost never missing
storage; it is that surfaces do not read what storage holds.

### The data spine

```
Vision ──< Goal ──< Goal ──< Action ──< Action
 (1)      (year)  (quarter)  (month)   (week)
```

The constraints matter more than the shape, because they are what a design has
to live inside (`20260816000200_canonical_core.sql:71,90,120`):

| Column                     | Nullable | Consequence for this design                                                                 |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `goals.vision_id`          | **no**   | An initiative cannot exist before a Vision does. Onboarding must guarantee one.             |
| `goals.horizon_id`         | **no**   | **An initiative must be anchored to a planning period even though it has none.** See Gap 2. |
| `goals.parent_goal_id`     | yes      | The goal hierarchy is a real tree, already recursive in trash cascades                      |
| `goals.status`             | --       | `draft, active, paused, achieved, abandoned` -- **`paused` already exists**                 |
| `actions.goal_id`          | yes      | Work with no initiative is already legal                                                    |
| `actions.parent_action_id` | yes      | Self-referencing, unconstrained by horizon. Arbitrary nesting is storable                   |
| `actions.horizon_id`       | **no**   | Every Action belongs to a period, including ones that conceptually do not                   |
| `actions.status`           | --       | `open, in_progress, blocked, done, dropped`                                                 |

Two of these are correction to the earlier draft. `paused` on goals was proposed
as a new status; it has existed since the first migration. And `goals.horizon_id`
being NOT NULL is a genuine obstacle the earlier draft missed entirely.

### The operation layer

Every durable mutation goes through a named, versioned Operation
(`web/src/lib/operations/index.ts`). This is not a convention -- it is enforced
infrastructure, and it sets the real cost of each step in the build order:

- **`operation_contracts`** stores `risk_class`, `exposures`
  (`ui | chat | mcp | automation`) and `reversible` per operation id. A new
  operation that is not registered here cannot be dispatched.
- **`operation_undo_support`** stores an undo `strategy` per operation
  (`trash-create`, `snapshot`, ...). Undo is not optional, and a `snapshot`
  strategy means a before-image is captured on every write.
- **`operation_receipts`** plus a `pg_advisory_xact_lock` on
  `workspace + operation + idempotency_key` make every operation replay-safe.
- Concurrency is **optimistic**: almost every input carries `expectedVersion`,
  and a mismatch raises `version_conflict_or_not_found` at SQLSTATE `40001`.

The practical rule this produces: **a step that needs no new operation is
dramatically cheaper than one that does.** Steps 1 and 2 of the build order below
need none. That is why they come first.

A relevant detail of the existing inputs
(`web/src/lib/operations/index.ts:382,416`):

- `action.create.v1` takes `horizonKind: 'month' | 'week'` and **already
  accepts `parentActionId`**. Nested creation is possible today; only the
  interface declines to offer it.
- `action.move.v1` takes `goalId` as **non-nullable** and `scheduledOn` as
  **non-nullable**. Reparenting an Action therefore forces it to have a goal and
  a date. This will bite when an initiative's backlog wants neither.

### The surfaces, and what each can see

| Surface                   | Reads                                                    | Cannot see                                                 |
| ------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| `/planner`                | The full hierarchy, filtered to one of four horizon tabs | Any relationship between an item and its siblings' history |
| `/today`                  | Actions scheduled today, up to five in focus             | Anything about the week                                    |
| `/review` (week)          | **Unfinished** actions only, in one flat list            | **What was completed.** Carry counts. Initiatives          |
| `/review` (month/quarter) | Counts and goal progress                                 | Per-initiative detail                                      |
| `/notes`                  | The note tree, with links to goals and actions           | Task state on a linked action                              |
| `/planner/inbox`          | Unfiled actions                                          | --                                                         |

Three things are worth reading off that table.

**The weekly review is the only surface that does not show completed work**, and
it is the surface whose entire purpose is to look back at a week. `getWeeklyReviewData`
(`web/src/app/review/actions.ts:156`) filters `.in('status', ['open','in_progress','blocked'])`
on both of its queries. There is no third query. Nothing about `completed_at` is
loaded, so nothing about it can be shown.

**`/planner` and `/review` see the same rows through incompatible lenses.** The
planner renders four separate horizon tabs; the review renders one flat list
across horizons. Neither groups by goal. A project-shaped ritual has no home in
either.

**`/goals` is a permanent redirect to `/planner`** (`web/src/app/goals/page.tsx`).
There is no goal-centric screen in the product at all, which is precisely the
shape an initiative needs.

### What the review already enforces

`review.complete-weekly.v1` is the most rigorously specified operation in the
codebase, and most of the weekly pass's rules are already inside it
(`20260909161000_weekly_review_names_a_finished_week.sql`):

- **The decision set must be exact.** Every eligible Action must be decided and
  no ineligible one may appear, or the operation raises
  `review_action_set_changed` at `40001`. Eligibility has a single definition,
  the SQL function `review_week_eligible_actions`
  (`20260909120000_weekly_review_includes_scheduled_work.sql:21`), used by both
  the loader and the writer so the two cannot drift.
- **`blocked` and `dropped` require a reason.** A blank one raises
  `invalid_review_decision`.
- **Priorities are capped at five per week**, and a priority may not be attached
  to a `done` or `dropped` item -- `too_many_weekly_priorities`.
- **A week can be reviewed once**, via `raise_if_period_already_reviewed` plus a
  partial unique index on completed reviews per horizon.
- **Carrying is a real move, not a copy.** `next_week` sets the Action's horizon
  to `starts_on + 7` and its `scheduled_on` to the same, then writes the history
  row.

That fifth bullet is the design already being half-built. That third bullet is
moment 5 of the ritual -- "what is next week actually for?" -- already
implemented, already capped at the right number, already validated server-side,
and never presented as the point of the screen.

### What AI already does here

Correction to the earlier draft, which said the weekly analysis had "nothing
computed." Half of it exists, and it is the AI half. There is a
`review_ai_proposals` table, an `ai_jobs` row with `operation = 'review_analysis'`,
and a validated proposal shape (`web/src/lib/review-proposals.ts:36`): a
`summary`, up to five `priorityActionIds` checked against the real unfinished
set, up to eight `recommendations` each carrying up to four evidence references,
and one to four `reflectionPrompts`.

So the model can already read a week and propose next week's five priorities.
What is missing is the **deterministic** half -- the record of what happened,
computed from `completed_at` and `action_schedule_history`, which is the half
that has to work when AI is off, and the half the owner actually asked for.

This reverses the intuition about ordering. The AI feature is the one that is
nearly done. The boring count is the one to build.

## The five gaps

### Gap 1: nesting is stored but unreachable

`actions.parent_action_id` is a plain self-referencing foreign key
(`20260816000200_canonical_core.sql:124,143`) with **no constraint tying a child
to a different horizon**, and the database already walks it to arbitrary depth:
`20260905130000_goal_achievement_is_not_archival.sql:480` and
`20260817001400_planning_snapshot_undo.sql:264` both join a recursive
`descendants` CTE so archiving and undo cascade through a whole subtree.

The interface is what assumes one level. `web/src/app/actions.ts:468` sets
`parentActionId` only when creating a weekly Action, and only to its monthly
parent; `web/src/app/actions.ts:342` then reads that same column straight back out
as `monthly_id`. The one relationship the schema offers has been spent on the
monthly-to-weekly rollup, and there is no way to put a task under a task.

This is the same shape as the Notes tree before it got disclosure controls: the
storage was always a tree, and the screen flattened it.

**Recommendation: stop reading `parent_action_id` as "the monthly one".** It
already means "this Action sits under that Action". A weekly Action under a
weekly Action is the same relationship one level further down, and the cascades
are already recursive. What changes is the read path and the interface, not the
schema:

- derive the monthly rollup by walking up to the nearest ancestor whose horizon
  kind is `month`, rather than assuming the immediate parent is it;
- give the planner the same disclosure, indent and outdent controls Notes has,
  against the same `action.move.v1` that already reparents. `renderItem` in
  `planner-workspace.tsx` already takes a `depth` argument, so the renderer is
  closer than it looks;
- bound the depth at four -- more than the owner's export uses -- so the
  recursive undo functions keep a predictable cost, and enforce it in the
  operation rather than the component.

Two hazards specific to this change, both real:

- `action.move.v1` requires a non-null `goalId`. Indenting an Action under a
  parent that has no goal is currently unrepresentable. Either the child inherits
  the parent's goal (simplest, and matches how weekly creation already copies
  `goal_id` off the monthly parent at `web/src/app/actions.ts:450`), or the input
  becomes nullable, which is a new operation version.
- Nothing stops a cycle. Notes guard against this with a recursive check
  (`20260816000400_notes_vault.sql:229`); actions have no equivalent. Reparenting
  must gain the same guard, or an Action can be made its own ancestor and the
  recursive cascades will not terminate.

### Gap 2: an initiative is not a goal

A Goal in Planner AI is built to be _finished_: it has `due_on`, `achieved_at`,
`target_value`, and the Review asks whether it was reached. "Real estate agent
business" and "Planner AI" are never reached. Filing them as Goals means being
asked every quarter whether the business is done.

They are also not Notes. A Note holds writing; these hold _work_, and that work
has to reach Today, This Week, and the Review.

**Recommendation: an Initiative is a Goal with a different kind, not a new
table.** Add `goals.kind` (`outcome` by default, `initiative`), where an
initiative has no `due_on`, is never `achieved`, and moves between the `active`,
`paused` and `abandoned` statuses **that already exist**. That inherits, at the
cost of one column and one migration:

- the whole goal hierarchy and its link to Vision (`vision_id`, `parent_goal_id`);
- `note_goal_links` (`20260816000400_notes_vault.sql:81`), so the project's page
  and its work are the same thing;
- `actions.goal_id`, so every task already knows its initiative;
- Horizons, Review and the planner UI, each of which needs only to filter.

A new table would duplicate every one of those, and would need its own RLS
policies, trash cascade, undo strategy, export entry and generated types.

**The obstacle the earlier draft missed: `goals.horizon_id` is NOT NULL.** An
initiative is timeless, and the schema will not let it be. Three options:

1. **Anchor to the current year horizon.** No migration to the constraint, and
   `planning_horizons` rows for years already exist. The cost is a small lie in
   the data -- an initiative appears to belong to 2026 -- and a decision every
   January about whether to re-anchor.
2. **Make `horizon_id` nullable when `kind = 'initiative'`,** with a check
   constraint tying the two. Honest, but it touches a column every planner query
   joins on, and every one of those joins would need auditing for an inner join
   that would now silently drop initiatives.
3. **Introduce a `kind = 'standing'` horizon** with a wide date range. Keeps
   joins intact and the data honest, at the cost of a value in
   `planning_horizons.kind`'s check constraint that every `kind` switch in the
   codebase must learn.

**Recommendation: option 1 for the first ticket, option 3 if year-anchoring
starts producing visible nonsense.** Option 1 is reversible in a single update
statement and does not touch a constraint; that is worth a small modelling
compromise while the shape is still being proven against a real week.

### Gap 3: the week never reports what it finished

This is the owner's first request and it has no implementation. The weekly review
loads two queries, both filtered to `['open','in_progress','blocked']`
(`web/src/app/review/actions.ts:156`). `completed_at` is never read. The screen
that exists to look back at a week is structurally incapable of showing the week.

**Recommendation: a third query**, over actions in the same seven days with
`status = 'done'` and `completed_at` inside the range, grouped by `goal_id`. No
migration, no operation, no AI. It is the smallest change in this document and it
is the one the owner asked for first.

The one subtlety: an Action completed this week may have been _created_ in a
week three months ago, and its `horizon_id` may still point there. Grouping by
`completed_at` rather than by horizon is what makes the list match what the owner
remembers doing.

### Gap 4: the age of open work is invisible, and the obvious fix is a trap

The signal this whole design rests on is **how long a task has been sitting**.
The obvious implementation is to count `action_schedule_history` rows. That
implementation is wrong, and the reason is the most important correction in this
document.

`action_schedule_history` rows are written **inside the loop over the submitted
decisions** and nowhere else
(`20260909161000_weekly_review_names_a_finished_week.sql:178`). One row per
decision. No decision, no row.

So the moment step 3 stops requiring a decision on every item -- which is the
entire point of step 3 -- **those items stop accruing history, and the carry
count silently stops counting.** The signal is a byproduct of the tax the design
exists to remove. Build both as originally written and the second ticket quietly
disables the first.

The same trap catches priority. `review_action_items`, which is where the
`priority` flag lives, is written in that same loop. An item that needs no
decision cannot be flagged as next week's priority, because it never appears in
the payload.

**Recommendation: derive age from checkpoints survived, not from actions taken.**

```
weeks carried = count of completed weekly reviews
                whose week began after this Action was created
```

Both halves already exist: `reviews` filtered to `kind = 'weekly'` and
`status = 'completed'`, joined to `planning_horizons.starts_on`. That definition
is better on five counts, not just on this one:

- **It survives step 3.** It does not care whether a decision was made.
- **It works retroactively.** Every Action that already exists gets a correct
  number the day the feature ships, with no backfill.
- **It handles a skipped week correctly.** Two calendar weeks with one review is
  one checkpoint survived, which is the honest reading -- the item has been
  looked at once.
- **It cannot double-count.** An item touched twice in one review still survived
  one checkpoint.
- **It is one join**, not a per-row lateral count.

The one case it does not cover is a workspace with no completed reviews at all,
where every count is zero. Fall back to calendar weeks since creation, labelled
differently ("3 weeks old" rather than "carried 3 times"), so the number is never
silently wrong.

**Thresholds:** nothing at one, a quiet marker at two, an amber marker and a
required decision at three or more. Three is the first number at which "still
doing it" stops being credible without a reason, and it matches the existing
five-priority discipline in feeling -- small, opinionated, and cheap to argue
with.

**And `priority` needs its own channel.** In `review.complete-weekly.v2` the
decision array becomes optional per item rather than exhaustive, with three
rules: an item carried three weeks or more **must** appear; any item **may**
appear; and appearing is the only way to carry a priority flag. A new `keep`
resolution covers "I looked at this and it stays", which is also what makes
priority attachable to an item that needed no decision.

### Gap 5: the review's decision set is unbounded, and capped at 100

This one is a live correctness problem, not a missing feature, and this design
makes it worse before it makes it better.

`review_week_eligible_actions` includes week-horizon work where
`horizon.starts_on <= p_ends_on` -- that is, **every unfinished weekly Action from
every past week, forever**. The completion operation rejects any input with more
than 100 decisions (`jsonb_array_length(p_input -> 'decisions') > 100` raises
`invalid_operation_context`).

So an owner who accumulates 101 unfinished weekly Actions can no longer complete
a weekly review at all, and the failure arrives as a generic invalid-context
error with no path out. The current forced-decision screen masks this, because it
pressures the backlog down every week. A design that makes carrying free removes
that pressure and walks straight into the cap.

**Recommendation: fix this in the same ticket that makes carrying free, not
after.** The decision set should be bounded by what the screen actually asks
about: items carried three weeks or more, plus items explicitly touched this
week. Everything else stays open without appearing in the payload. That requires
a new eligibility function and therefore `review.complete-weekly.v2` -- the first
new operation in this design, and the only unavoidable one.

`v1` must keep working. Operations are versioned precisely so that an old
receipt, an old undo record, and an old MCP client all continue to resolve.

## The features asked for

### A suggested breakdown when an initiative is created

`ai_proposals` already wraps an `operation_id` with `input_json`, a `batch_id`,
`status` and `applied_at`, and the capture flow already turns a batch into real
records atomically. A breakdown is **a batch of proposed `action.create.v1`**
against the new initiative -- no new machinery, one new prompt and one new entry
point.

It must stay a proposal. The owner accepts, edits or discards each line before
anything is written, exactly as capture proposals work today, and it must be
usable with AI switched off, which means the initiative is fully usable with an
empty task list.

One constraint makes this less free than it looks. `capture_proposal_batches`
adds `batch_id` and `sort_order` to `ai_proposals` under a check that a batched
proposal **must also carry a `source_capture_id`**
(`20260817003100_capture_proposal_batches.sql:41`). A breakdown originating from
an initiative has no capture behind it. Either the entry point writes a capture
first -- which is arguably honest, since "break this down" is a thought the owner
had -- or the check is relaxed to allow a batch with no capture. **Recommendation:
write the capture.** It keeps the constraint, gives the proposal a provenance
record, and makes the breakdown visible in Activity like every other AI write.

Two design notes that decide whether this is useful or annoying:

- **Propose shape, not volume.** Twelve generic tasks are worse than four real
  ones. The prompt should be bounded to around five top-level items, matching the
  five-priority and five-focus discipline already in the product.
- **The best input is the definition of done**, not the title. "Real estate agent
  business" yields nothing useful. "A signed contract or a clear no by the end of
  Q3" yields a plan. This is an argument for asking for the definition of done at
  creation time, before offering the breakdown.

### Major tasks and subtasks

Gap 1, and its two hazards. Nothing else.

### An analysis of the week

Half exists and is the AI half; see above. What must be built is the
deterministic record, per initiative: completed, still open with carry counts,
dropped with reasons, and recurred. Computed from Operations, so it works with AI
off and cannot be wrong.

The AI summary then has a genuine job rather than a decorative one: it reads the
computed record and says what the owner would not have noticed -- that one
initiative absorbed most of the completions, that another has had nothing finish
in three weeks, that four of the five carried items are all waiting on the same
person.

### A definition of done, and the line to direction

`goals.target_value` / `unit` express a measurable target, and
`description_markdown` holds prose, but nothing says _what finished looks like_
in words on either a Goal or an Action.

For an initiative, "done" is the wrong question -- the right one is **what good
looks like this quarter**. Proposal: one `definition_of_done` field on goals,
required for an `outcome` and optional for an `initiative`, shown at the top of
the initiative and quoted in the Review at the moment a decision to drop is made.

The line to direction already exists and only needs showing: an Action knows its
Goal, a Goal knows its parent and its Vision. The initiative page should render
that chain, and the weekly pass should group by it, so the answer to "why am I
doing this" is on screen rather than reconstructable.

## The weekly pass

One screen, one initiative at a time, four parts:

- **Done this week** -- what completed, with its subtasks, from `completed_at`.
- **Still open** -- the carried list, each item showing how many weeks it has
  been carried. Anything at three or more is offered for dropping first, because
  that is the number that says nobody is going to do it.
- **Came round again** -- what recurs here, stated once as a template rather
  than retyped every week.
- **New** -- one line to add, filed under the initiative, nested where it belongs.

**Correction from the build: an occurrence is marked in place, not moved into
its own section.** Drawing it as a fourth band is what the mockup does, and it
is wrong. An occurrence still needs acting on, so lifting it out of the open
list makes the week look emptier than it was and splits the reader's attention
across two lists that want the same decisions. What each initiative lists
instead is its recurring **templates** and their cadence -- the part that is
genuinely stated once -- while an Action produced by one carries a marker in the
open list so it reads as "this came round again" rather than as work nobody did.

Every count is computed from records that already exist. Nothing here needs a
model, which is what keeps the ritual working with AI off -- and every section
needs an honest empty state, because on a new workspace three of the four are
empty for the first three weeks.

## The screen

This is a refit of `/review`, not a new surface. That route already lists
unfinished Actions and asks for a decision on each
(`web/src/components/weekly-review.tsx:186`); what it has never shown is what the
week _finished_, which is the first thing the owner wants from it. Mockup:
[The Weekly Pass](https://claude.ai/code/artifact/f91b55fe-37ff-4e99-8923-726e4647062e).

### Shape

One column of initiatives, one sticky rail for next week.

```
Week of 8-14 September
[ finished 14 ] [ open 9 ] [ need a decision 3 ] [ recurred 5 ]

+-- TEK Systems - Amazon ------------------+  +-- Next week ---------+
|  Vision > Steady income > Q3 Land a role |  |  One line: what would|
|  Good this quarter: a signed contract,   |  |  make it worth it?   |
|  or a clear no so the time goes elsewhere|  |  [..................]|
|                                          |  |                      |
|  FINISHED  5                       (sunk)|  |  1 Ask Ivory for a   |
|    v Reach out to Baily             Mon  |  |    date         TEK  |
|    v Pull tasks from the thread     Mon  |  |  2 Create the        |
|    v Reach out for Ivory            Wed  |  |    invoice     1679  |
|    v Send the updated CV            Thu  |  |  3 Show what the week|
|    show 1 more                           |  |    finished  Planner |
|                                          |  |  4 - - - - - - - - - |
|  STILL OPEN  2                           |  |  5 five is the cap   |
|  [ ] Look at other TEK roles    2nd week |  |                      |
|  +--------------------------------------+|  | [ Start next week ]  |
|  |[ ] Wait for a new start   [4th week] ||  |  3 priorities        |
|  |    [Make it concrete] [Keep] [Drop]  ||  |  6 carried           |
|  +--------------------------------------+|  +----------------------+
|    waiting is not a task -- it has no    |
|    next action you control               |
|                                          |
|  - - - - - - - - - - - - - - - - - - - - |
|  COMES ROUND AGAIN                       |
|    ^ Weekly claim status check  every Mon|
|                                          |
|  + Add to TEK Systems                    |
+------------------------------------------+

+-- Before you close the week -------------------------------------+
|  [ the reflection, full width, last, and optional ]              |
+------------------------------------------------------------------+
```

The row that matters is the first one under **STILL OPEN**: no buttons at all.
Six of the nine open items on this screen ask for nothing. That is the design.

### The decisions that make it cheap

**Finished leads.** Each initiative opens with what closed, then what is still
open. The order answers the question the owner came to the screen with, and it is
the half the current screen cannot render at all.

**Keep is the default, and most items need no decision.** Today's review asks the
owner to resolve _every_ unfinished Action, which is the weekly tax this design
exists to remove. Once work carries rather than being copied, and once the carry
count is visible, staying open is free and silent without being invisible. Only
items carried three weeks or more are put in front of the owner. That single
change is most of the saving -- and it is also what forces Gap 5 to be fixed in
the same ticket.

**The carry count is the primary signal**, quiet at one or two weeks and amber at
three or more. It is the only number that says nobody is ever going to do this,
and it exists _because_ nothing is copied.

**A stalled item gets a reason, not just a flag.** The operation already requires
one for `blocked` and `dropped`. "Wait for a new start date, 4th week" is worth
naming as what it is: waiting is not a task, because it has no next action the
owner controls. An initiative with weeks of no movement is offered **pause**
rather than drop -- `goals.status = 'paused'`, which already exists -- so it stops
appearing in the weekly pass while keeping everything filed under it. That is the
owner's "clean it up" step, made explicit and reversible.

**Direction is on screen, not one click away.** Each initiative header carries its
chain -- Vision, yearly Goal, quarterly Goal -- and its definition of done in
plain words. Dropping something is only defensible when the criterion is visible
at the moment of dropping.

**The rail is the existing priority mechanism, finally shown as the point.** The
five-item cap, the exclusion of completed and dropped work, and the server-side
validation are all already built and already tested. What the rail adds is
framing: this is not metadata on a review, it is the answer to "what is next week
for?". The primary control reads `Start next week - 3 priorities, 6 carried`.

**Planning is the exit from reviewing.** There is no separate trip to a planning
screen, because the moment the owner knows what to plan is the moment they have
just finished looking at the week.

### Two questions the mockup now answers

Both were listed as open in the previous draft. Drawing the screen at real scale
settled them.

**Finished shows four lines and a count, then "show N more".** It is the answer
to the owner's first question and also the part that grows largest -- at fourteen
completions across four initiatives, an expanded list buries the work that still
needs attention. Four lines is enough to recognise the week; the count carries
the rest. It is also styled as a **receipt rather than a worklist** -- sunken
ground, ticked, dated, smaller type -- so that it reads as a different kind of
object from the live rows below it. Two lists that look identical is what made
the first mockup unreadable.

**The reflection is a full-width step below the initiatives, not a panel in the
rail.** A paragraph about the week does not belong in a 280px column, and putting
it last matches the order of the ritual: look, decide, aim, then write. The rail
holds only the thing the rail is for -- next week's five.

### Still open

- Whether an initiative with no open work and no completions should appear at all.
  The mockup omits it, which is right on the first Sunday and possibly wrong in
  week twenty when it is the only signal that a project has gone quiet.

## Does this actually work?

Everything above argues the design is _correct_. Correct is not the same as
effective, and the gap between them is where features like this die. This
section tries to break it.

### Week one, on a workspace with nothing in it

The single largest effectiveness risk, and the one the earlier drafts never
mentioned.

Nothing in the planner is imported. A Notion import creates **Notes**
(`note.import-commit.v1`); there is no path from an imported page to an Action
except capturing and filing it one at a time (`capture.file-to-action.v1`). So
the planner starts empty. On the first Sunday:

| Section          | Shows                                  |
| ---------------- | -------------------------------------- |
| Finished         | whatever was completed since setup     |
| Still open       | whatever was typed in                  |
| Carried 3+ weeks | **nothing.** There are no past reviews |
| Came round again | **nothing.** No templates exist yet    |
| Next week        | works from day one                     |

**Three of the five sections are empty in week one, and the carry count -- the
signal the design rests on -- reads zero for everyone until the third completed
review.** A design judged on its first use would be judged on its worst showing.

Three consequences, each of which changes the plan:

1. **Step 1 must carry the first three weeks on its own.** Showing what
   finished is the only part that works immediately, which is a second reason it
   goes first, and a reason not to hide it behind anything else.
2. **Seeding is typing, and that is fine.** Four initiatives and roughly twenty
   open tasks is ten minutes, once. It is the same ten minutes the ritual already
   costs. This is worth stating explicitly so that nobody builds a Notion-to-Action
   importer to avoid it -- that would be a large, lossy, single-use feature to save
   one sitting.
3. **A cold-start blocker exists and must be handled.** `goals.vision_id` is
   NOT NULL, and onboarding's `visionText` is **nullable**
   (`web/src/lib/operations/index.ts:1042`). An owner who skipped the vision step
   has no Vision, and therefore **cannot create a Goal of any kind, including an
   initiative.** Step 5 must either prompt for a Vision inline via
   `vision.upsert.v1` or refuse clearly. Silently failing to create an initiative
   is the worst first impression this feature could make.

### Four weeks, walked through

Using the projects from the export. This is the cheapest test available and it
found two of the problems above.

**Week 1.** Four initiatives typed in, nineteen tasks under them. Nothing
finished yet, nothing carried. The screen is mostly the _Next week_ rail: five
priorities chosen out of nineteen. Value delivered: the aiming step, which the
current product has but does not present. Verdict: **thin but not empty.**

**Week 2.** Six tasks finished, thirteen open. Finished leads and is the part
that feels good. Nothing is amber yet -- one checkpoint survived. Three new tasks
added under TEK Systems. Zero retyping. Verdict: **already better than the
Notion ritual**, purely from step 1.

**Week 3.** "Wait for a new start date" hits two checkpoints. Quiet marker, no
decision required. Real estate agent business has had nothing finish in three
weeks; the initiative itself is the thing that is stalled, not any one task.
Verdict: **the design needs a per-initiative signal, not just a per-task one.**
This is a genuine gap the walkthrough found -- a task that is three weeks old is
noise if the whole initiative is deliberately dormant. Fix: derive the same
number for an initiative from its most recent completion, and offer **pause**
at three empty weeks.

**Week 5, after skipping week 4.** Two calendar weeks, one review. Checkpoints
survived increments by one, correctly. The Finished list, if bounded by the
calendar week, shows seven days and hides the other seven -- which is why it must
be bounded by the **last completed review** instead. Verdict: **the fallback
matters and is cheap.**

**Week 8.** "Wait for a new start date" is at six. It has been amber for four
weeks and the owner has kept it every time. Verdict: **escalation that never
escalates is wallpaper.** An item kept three times after going amber should stop
asking and start proposing -- convert it to a recurring check, park it in a
someday list, or drop it -- because the owner has now answered the question three
times and the screen has not listened.

### What "effective" means, in terms that can be checked

Not opinions. Each of these is a test that can be written.

| Claim                          | Check                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| **No retyping**                | A task open in week N appears in week N+1 with the same `id`. Assert on identity, not text  |
| **Cost does not scale**        | With 150 open Actions, closing a week requires **at most 5 + n(3-week items)** interactions |
| **It cannot get stuck**        | A workspace with 150 carried Actions completes a weekly review without error                |
| **It works with AI off**       | Every count on the screen renders with the provider disabled. No section is empty-on-error  |
| **It survives a skipped week** | Two weeks, one review: Finished covers 14 days, carried counts increment by 1               |
| **It works on day one**        | A workspace with no reviews and no history renders every section with an honest empty state |
| **Direction is never guessed** | Every initiative header renders its real chain, or says plainly that it has none            |

The first two are the feature. If a build passes everything else and fails
either of those, it has not replaced the ritual -- it has re-implemented it.

### What to cut

The most reliable way to build something good here is to build less of it. Three
candidates, in order of confidence:

**Cut the AI breakdown from the plan entirely for now.** It is the only step
needing a provider, the only one that cannot be verified deterministically, and
the one whose value depends most on the definition-of-done field that does not
exist yet. Nothing else in the design waits on it. Revisit after the pass has run
for a month.

**Defer nesting until after the weekly pass ships.** It is the most expensive
step -- a read-path change with a cycle guard and a depth bound -- for a property
that applies to a minority of tasks. The export shows exactly one two-level
example. Until then `description_markdown` already holds a checklist of sub-steps
on an Action, which is the cheap version of the same thing. If the weekly pass
runs for a month and the description checklists feel wrong, build it then, against
evidence. This is a sequencing call rather than a refusal: the request was real,
the urgency was assumed.

**Do not build a priority container, a default personal initiative, or an
Action importer.** Each is answered elsewhere in this document, and each would
add a second place for something that already has one.

That leaves **steps 1, 2, 3 and 5-6** as the feature. Four tickets, one
migration, one new operation.

## Build order

**Status: all eight shipped.** What the build changed about this plan is
recorded under each ticket, because a good deal of what it changed was the plan
rather than the code.

Eight tickets, not four. Steps 1 to 4 were the feature as scoped above, and each
carries a **kill criterion** -- the evidence that would say stop rather than
continue. Steps 5 to 8 are the deferrals, which were cut for sequencing rather
than refused, and are [recorded as closed](#the-four-deferrals-since-closed) at
the end. Each ticket is usable alone, and only step 8 touches a provider -- as an
offer on a new initiative, not as a step in the weekly pass. The roadmap permits
one active implementation ticket at a time, so this was a queue.

### 1. Show what the week finished

**Shipped.**

**Changes:** one additional query in `getWeeklyReviewData`
(`web/src/app/review/actions.ts:156`) over Actions with `status = 'done'` and
`completed_at` **inside the window since the last completed weekly review**,
falling back to seven days when there is none; grouped by `goal_id`; a `Finished`
section leading the screen.

**New operations:** none. **Migrations:** none. **Risk:** near zero -- a read.

**Why first:** it is the owner's first request, the cheapest change in this
document, and the only part of the design that works in week one. Before step 4
the grouping is by quarterly Goal rather than by initiative, which is coarse but
real; the section is worth shipping at that fidelity.

**Kill criterion:** after three weeks of use the Finished list is routinely
empty or wrong because work is completed outside the app. If that happens, the
problem is capture, not review, and the rest of this plan is premature.

### 2. Show how long open work has been sitting

**Shipped.**

**Changes:** weeks carried, derived from completed weekly reviews rather than
from `action_schedule_history` (see Gap 4); a marker on each row; the open list
sorted by it descending. The calendar-week fallback for a workspace with no
reviews ships in the same ticket, labelled differently so the number is never
silently wrong.

**New operations:** none. **Migrations:** none. **Risk:** low -- still a read.

**Why second:** it is the signal the rest of the design rests on, and deriving it
this way means it is correct retroactively on day one rather than three weeks
later.

**Kill criterion:** after a month, the distribution is flat -- almost everything
is at zero or one, or almost everything is amber. Either outcome means the number
is not discriminating, and steps 3 and 4 need a different signal before they are
built.

### 3. Bound the review, and make keeping free

**Shipped** as `20260915090000_keeping_open_work_is_free.sql`.

**Changes:** a new eligibility rule (`review_week_required_actions`, and a
`review_stalled_after_checkpoints()` so the threshold has one definition in SQL
as well as one in TypeScript); a `keep` resolution; the decision array becomes
**optional per item** under three rules -- an item carried three weeks or more
must appear, any item may appear, and appearing is the only way to attach a
priority flag.

**Correction: there is no `review.complete-weekly.v2`.** A relaxed requirement
and an extended enum are both _widenings_ -- every payload that was valid before
is still valid and still produces the same result -- so `v1` was widened instead.
A new operation id would have bought no compatibility and would have required
three edits inside the weekly-review undo machinery, which pins the operation id
in a trigger guard, a receipt lookup and an undo dispatch. Versioning is for
changes that break a caller; this one cannot.

**Near-miss worth recording:** rebuilding the `action_schedule_history` reason
check from its _original_ migration silently dropped `'undo'`, which a later
migration had added. The undo suites caught it. Rebuild a check constraint from
the live definition, never from the migration that first created it.

**New operations:** none. **Migrations:** one. **Risk:** the highest here.

This is the step that removes the weekly tax, and it is also the step that fixes
[Gap 5](#gap-5-the-reviews-decision-set-is-unbounded-and-capped-at-100). They
cannot be separated: making keeping free without bounding the eligible set walks
the owner into the 100-decision cap. `v1` stays dispatchable so existing receipts,
undo records and MCP clients continue to resolve.

**Verified by:** pgTAP on the new eligibility rule, including a workspace with 150
carried Actions; a test that `v1` still completes; an undo test on `v2`; and the
interaction-count assertion from the effectiveness table.

**Kill criterion:** the bounded set turns out to hide something the owner needed
to see, and they start opening the planner to check what the review did not ask
about. That is the tax returning in a worse form.

### 4. Initiatives, and the pass

**Shipped** as `20260915100000_an_initiative_is_never_finished.sql`.

These ship together, because an initiative with no screen is not worth a
migration and the pass with no initiatives is the current flat list.

**Changes:** `goals.kind` defaulting to `outcome`; initiatives anchored to the
current year horizon; `goal.create.v1` and `goal.update.v1` extended; **an inline
Vision prompt for the cold-start case**, since a workspace that skipped onboarding's
optional vision cannot create a Goal at all; the review grouped by initiative with
the four sections; the rail wired to the existing five-priority flag and showing
its cap; **pause offered on an initiative with three empty checkpoints**, which is
the per-initiative signal the walkthrough found missing.

**New operations:** none new; two extended, which means new versions since the
input schemas are `.strict()`. **Migrations:** one. **Risk:** medium, concentrated
in the horizon anchoring -- audit every inner join on `planning_horizons` for
queries that would now surface or hide initiatives unexpectedly.

**Kill criterion:** grouping by initiative makes the screen longer without making
it clearer, because in practice most work sits under one or two of them. If that
is what a month shows, the grouping is decoration and a flat list sorted by age is
the better screen.

### 5. What good looks like, and the line to direction

**Shipped** as `20260915110000_what_good_looks_like.sql`.

**Changes:** one `definition_of_done` field on goals, named for the question that
actually applies rather than for the word "done" -- "Real estate agent business"
is never done, so the field asks what would make this quarter good here. The
Weekly Review quotes it twice. Once on the initiative, alongside the chain of
Goals the work answers to, so "why am I doing this" is on screen rather than
reconstructable from three other pages. And again beside the reason field the
moment a decision to drop is selected, because dropping is only defensible while
the standard it failed is visible; reconstructing that standard afterwards is how
the one task actually serving a goal gets dropped.

**Correction: the field is optional in the schema for every kind of Goal.** This
document proposed requiring it on an `outcome`. Making the column NOT NULL would
have needed a value for every Goal that already exists, invented by a migration
-- which is exactly the kind of fabricated content the field exists to prevent.
It is optional in the schema and prompted in the interface instead. Omitting the
key leaves the stored value alone rather than clearing it, so every caller
written before the field existed keeps working and none of them erases anything;
an empty string clears it.

**Two inconsistencies from step 4 are closed here as well.** `goal.update.v1`
refused an initiative the parent Goal that `goal.create.v1` allows, so a parent
could be set once at creation and never changed -- and the planner editor was
clearing it on every unrelated edit. And an edit could write a due date onto an
initiative, which the check constraint then rejected as a constraint name rather
than as a rule anyone could read. The editor now does not offer a due date on an
initiative at all, rather than offering one and refusing it.

**Worth recording:** the direction chain walk is bounded by the size of the goal
tree and tracks what it has already seen, so a malformed parent link cannot spin.

**New operations:** none; two extended. **Migrations:** one. **Risk:** low -- an
optional column and two reads.

**Verified by:** pgTAP (`what_good_looks_like.sql`) and the review journey
(`web/tests/e2e/journey-review.spec.ts`).

### 6. Show what comes round again

**Shipped.** No migration: recurrence has had somewhere to live in
`action_templates` since `20260817002800` without ever being visible from the
week it recurs in.

**Changes:** each initiative now lists what comes round under it, with its
cadence and its next occurrence, so "every week I invoice" is stated once
instead of retyped. An occurrence sitting in the open list is marked as
recurring rather than reading as work nobody did.

**Correction: occurrences are marked in place, not pulled into a section of
their own.** [The weekly pass](#the-weekly-pass) and the mockup both draw "Came
round again" as one of four sections. An occurrence still needs acting on, and
moving it out of the open list makes the week look emptier than it was while
splitting the owner's attention across two lists that want the same decisions.
The distinction that matters is legible either way, and one list is cheaper.

**New operations:** none. **Migrations:** none. **Risk:** near zero -- a read.

**Verified by:** the review journey (`web/tests/e2e/journey-review.spec.ts`).

### 7. Work nests

**Shipped** as `20260915120000_work_nests.sql` and
`20260915130000_nesting_does_not_require_a_goal.sql`.

**Changes:** a weekly Action may now sit under another weekly Action, the
planner renders that tree in both the week tab and the full hierarchy, and
indent and outdent move it. The monthly rollup is derived by walking up to the
nearest Action on the monthly horizon, as
[Gap 1](#gap-1-nesting-is-stored-but-unreachable) recommended -- reading it off
the column reported a sibling task as the month the moment a weekly Action had a
weekly parent. Two guards ship with it, neither of
which existed because nothing could reparent an Action before: the depth bound of
four, and the cycle guard Notes have had since their first migration, without
which an Action can be made its own ancestor and every cascade over
`parent_action_id` fails to terminate. **The bound is on where the moved
subtree's deepest leaf lands, not on the Action being dragged.**

**Correction: `goalId` became nullable on `action.move.v1`, and it cost no new
version.** Gap 1 offered two ways out and described the nullable one as "a new
operation version". It is not. A widened input accepts every payload that was
valid before, so the operation keeps its version, exactly as step 3 found for
`review.complete-weekly.v1`. The other option -- inheriting the parent's Goal --
would not have worked either: indenting two Actions captured from Today, neither
of which has a Goal, has no Goal to inherit, and it failed as a generic
"something went wrong". `goalId` is now nullable and the parent's Goal has to
match rather than be equal.

**Correction: `action.move.v1` also required a non-null `parentActionId`, so
outdent had nowhere to go.** `action.create.v1` has always allowed a weekly
Action with no parent, which is what Today produces, while `action.move.v1`
demanded one -- so an Action could be nested and never brought back out. This
document did not notice the asymmetry, and neither did reading the code: both
inconsistencies were found by the e2e test once indent was wired to a real
screen. Both are widenings, so the operation keeps its version.

**Worth recording:** `action.move.v1` writes an `action_schedule_history` row
with reason `rescheduled` on every move, so indenting would have inflated a carry
count derived from history. It is derived from completed reviews instead, which
is why nesting cost the age signal nothing. The trap
[Gap 4](#gap-4-the-age-of-open-work-is-invisible-and-the-obvious-fix-is-a-trap)
identified for an unrelated reason turned out to protect this step too.

**New operations:** none; one widened twice. **Migrations:** two. **Risk:**
medium, concentrated in the read-path change to the monthly rollup, which puts
every consumer of `monthly_id` in scope.

**Verified by:** pgTAP (`work_nests.sql`), unit tests on the nesting derivation
(`web/tests/unit/planner-nesting.test.ts`), and a planner journey that indents
and outdents (`web/tests/e2e/journey-planner.spec.ts`), which is what found both
corrections above.

### 8. Suggest a first list for a new initiative

**Shipped** as `20260915140000_suggest_a_breakdown.sql`.

**Changes:** a new initiative can ask for a first list of tasks. The proposal
machinery is reused whole -- an immutable Capture records that the owner asked,
`persist_capture_proposal_analysis_job` writes the batch atomically, and the
Action Inbox reviews it line by line. The whole migration is one new
`ai_jobs.operation` value, `initiative_breakdown`, so that a breakdown is
distinguishable in Activity and in the job history from a Capture the owner typed
themselves. The list is capped at five, matching the daily focus cap and the
weekly priority cap, on the reasoning this document already gave: twelve generic
tasks are worse than four real ones, and a list long enough to feel like a plan
is a list nobody edits.

**Writing the Capture was the right call.** The two ways past the
`capture_proposal_batches` check that a batched proposal must carry a
`source_capture_id` were to write a capture or to relax the check, and this
document recommended the first. That is what shipped: "break this down" is a
thought the owner had, recording it gives the batch a provenance, and the
constraint is left alone.

**The model's only influence is a list of titles.** Every identifier, date and
horizon in the resulting `action.create.v1` inputs is computed by the server from
the initiative it was asked about, and each input is validated against the
Operation's own schema before anything is written. A title the Operation would
reject is dropped rather than repaired, so the worst a bad completion can do is
produce a shorter list, and a model that returns nonsense produces zero proposals
rather than a bad write. That is deliberately narrower than the Capture flow,
which lets the model emit whole Operation inputs. A breakdown is asked for at a
moment when the workspace has nothing in it, so there are no real ids for a model
to reference and every one it produced would be a guess.

**The week the tasks land in is computed from the owner's timezone and their own
week start.** A breakdown that lands in the wrong seven days is not a cosmetic
error: it decides which week has to resolve the work.

**Correction to "no AI anywhere in the plan": there is now exactly one AI entry
point.** It is an offer rather than a step. The control is not rendered when AI
is off, an initiative is fully usable with an empty list, and nothing is written
until the owner accepts a proposal, so invariant 2 holds -- no number on the
weekly pass exists because a model said so.

**New operations:** none. **Migrations:** one, which only widens a check
constraint. **Risk:** low -- every write goes through the existing proposal
review.

**Why last:** for the reasons it was cut first, which stayed true. It is the only
step that needs a provider, the only one that cannot be verified
deterministically, and the one whose value depends on the definition-of-done
field that step 5 built. The prompt is given the initiative's title and that
field, and treats both as untrusted data rather than as instructions.

### What this order deliberately refuses

- **No new table.** Every gap is closed with a column, a read, or a screen.
- **No AI on the path through the week.** Every number is computed. Step 8 is
  the single AI entry point, it is an offer on a new initiative rather than a
  step in the weekly pass, and it is not rendered when AI is off.
- **No change to how work is stored before step 3.** Steps 1 and 2 are pure reads,
  so they ship in days and can be judged against a real week before anything is
  migrated.
- **Nothing that only works from week three.** Every ticket has to be worth having
  on the first Sunday.

### The four deferrals, since closed

Nothing on the deferred list was cancelled, and all four have since been built as
steps 5 to 8 above. The order they were taken in is not the order they were cut,
and the reasons are worth keeping.

**The definition of done went first, because two other things were waiting on
it.** Its own revisit condition -- step 4 has run and dropping decisions feel
unprincipled without it -- was met the moment the pass shipped, and the AI
breakdown has nothing to work from without it. It also turned out to be the
cheapest of the four: one optional column and two reads.

**Recurrence went second, and needed no migration at all.** The storage has
existed since `20260817002800`; only the reading of it was missing. That made it
the smallest of the four to build, and it is the one whose shape the build
disagreed with -- see the correction under step 6.

**Nesting went third, as the most expensive.** It was deferred on the argument
that `description_markdown` checklists were the cheap version of the same thing
and that the export shows exactly one two-level example. What settled it was not
that argument failing but the two operation inconsistencies it uncovered, neither
of which was visible until indent was wired to a real screen.

**The breakdown went last, for the reasons it was cut first.** It is the only
step that needs a provider and the only one that cannot be verified
deterministically, so it had the weakest claim on going early, and its value
depended on a field that did not exist until step 5. The sequencing call in
[What to cut](#what-to-cut) was right: it lost nothing by waiting, and it gained
a definition of done to work from.

## Risks, and how each is contained

| Risk                                                                     | Why it is plausible                                                       | Containment                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Free carrying breeds an invisible backlog**                            | The existing screen's author warned about exactly this                    | The carry count, escalation at three weeks, and a forced decision there         |
| **The carry count stops counting**                                       | History rows are written only per decision; step 3 removes most decisions | Derive age from completed reviews, not from history. Gap 4                      |
| **Priority becomes unattachable**                                        | `review_action_items` is written only per decision                        | A `keep` resolution; appearing in the payload is what carries a priority        |
| **Week one shows four empty sections**                                   | No history, no reviews, no templates on a new workspace                   | Step 1 leads and works immediately; every ticket must be worth the first Sunday |
| **An initiative cannot be created at all**                               | `goals.vision_id` is NOT NULL and onboarding's vision is optional         | An inline Vision prompt in step 4, or a clear refusal. Never a silent failure   |
| **Amber that never escalates becomes wallpaper**                         | An item kept three times after going amber has been answered three times  | After three keeps, stop asking and propose: recur, park, or drop                |
| **The 100-decision cap is hit**                                          | Eligibility already includes every past week, forever                     | Step 3 bounds the set and must ship with the change that makes carrying free    |
| **Widening `parent_action_id` breaks the monthly rollup**                | `monthly_id` is read directly off the column today                        | Ancestor walk, and find every consumer before the meaning changes               |
| **Reparenting creates a cycle**                                          | No guard exists on actions; the cascades are recursive                    | Port the Notes cycle check; bound depth at four in the operation                |
| **Initiatives anchored to a year horizon leak into year-filtered views** | `horizon_id` is inner-joined in most planner queries                      | Audit joins in step 4; option 3 (a standing horizon kind) is the escape         |
| **The feature becomes a second product**                                 | It touches the planner, the review, notes links and AI proposals          | It is a refit of `/review` plus one goal-centric page. No new route family      |
| **Scope grows past Stage 1**                                             | Every gap here suggests three more                                        | Steps 1-3 are the Stage 1 exit. Step 4 is justified separately                  |

## Open questions, with a recommendation on each

The earlier draft listed these without answers. A plan should take a position.

**Is "Urgent important tasks" a container?** No. It sits at the same level as the
businesses in the export, but modelling it as a project would give a task two
homes. Priority belongs on the task, and the product already has the right
mechanism in two places: the five-item weekly priority flag on
`review_action_items`, and the five-item daily focus list
(`daily-focus.set.v1`, `web/src/lib/operations/index.ts:1063`). **Recommendation:
use them. Do not build a priority container.**

**How much of a week genuinely recurs versus carries?** Unknown, and it decides
whether deferred recurrence surfacing is a convenience or the main event.
**Recommendation: step 2 answers this empirically.** Once carry counts are
visible against the owner's real history, the ratio is observable rather than
guessed, and that ticket can be sized properly when it is revisited.

**Where does a task with no initiative go?** "Oil change" is real work and belongs
to no business. `actions.goal_id` is already nullable, and `/planner/inbox`
already exists for unfiled work. **Recommendation: leave it nullable.** A default
personal initiative sounds tidier but creates a second place for the same thing
and would need to be created during onboarding, which is a migration on a flow
that is already delicate.

**Should the reflection stay freeform?** Yes, and it should come last. The
computed record answers "what happened"; the reflection answers "what do I make
of it", and that is the one part of the week a model should not pre-fill. The
existing `reflectionPrompts` from the AI proposal are the right level of help.

**What happens to a skipped week?** Unanswered and it matters, because real weeks
get skipped. Today's eligibility function handles it by accident -- everything
rolls up into the next review -- and the carry count keeps working because it
counts reschedules, not weeks. But the `Finished` section would show only the
current seven days, which is wrong after a two-week gap. **Recommendation: bound
the `Finished` query by the last completed weekly review's `completed_at` rather
than the calendar week**, falling back to seven days when there is none. Decide
this in step 1, because it changes the query.

## Invariants

Rules that must hold regardless of how the design evolves. If a future change
breaks one of these, it is the change that is wrong.

1. **Nothing is copied.** An Action has one identity for its whole life. Carrying
   is a move, and the move is recorded.
2. **Every number on the screen is computed from records.** No count exists
   because a model said so. The screen is fully functional with AI disabled.
3. **No silent rollover.** Work may stay open without a decision only while its
   age is visible and escalates.
4. **Every durable mutation is a versioned Operation** with a registered
   contract, an undo strategy, and an idempotency key.
5. **The week is a checkpoint, not a container.** Work belongs to its initiative.
6. **Ten minutes.** Any addition that costs the owner more decisions than the
   Notion ritual has to remove one somewhere else.
7. **The cost of closing a week does not scale with the size of the backlog.**
   This is the one invariant with a number attached: at most five decisions plus
   one per genuinely stalled item, whether there are twenty open Actions or two
   hundred.
8. **Every screen is worth opening on the first Sunday.** No part of this design
   may depend on history that a new workspace cannot have.
