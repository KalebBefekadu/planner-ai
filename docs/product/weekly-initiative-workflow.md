# The Weekly Initiative Workflow

Status: **design proposal.** Not yet accepted into [the roadmap](../roadmap.md).

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

## Where this design disagrees with the ask

**Copying last week forward is the wrong mechanism, and it is worth saying so
before building it.**

The weekly re-creation is not part of the workflow. It is a workaround for
something Notion cannot do: a Notion page has no idea which of its tasks are
still open, so the only way to carry work is to copy it by hand. Rebuilding
that copy step inside a tool that tracks task state would import the workaround
along with the ritual, and it costs something real.

Copying creates a **new record with a new identity**. "Reach out to baily"
copied into four consecutive weeks is four unrelated rows, and the single most
useful fact about it -- that it has survived four weeks untouched -- is
destroyed by the copying. That fact is the one that tells the owner a task is
never going to happen. Copying also duplicates every subtask beneath it, and
splits a task's history across records, so the Review can only ever describe
one week rather than the life of the work.

The same outcome, without any of that: **unfinished work simply stays open.**
An Action belongs to its initiative, not to a week. When a new week starts,
nothing is copied because nothing moved -- the open list is already there, with
its own history, its own subtasks, and a count of how many weeks it has been
carried.

What "starting from last week" actually asks for then decomposes into three
different things, which are better kept apart because they behave differently:

| What repeats                                                                        | What it really is | Where it lives                                                  |
| ----------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------- |
| Work still not finished                                                             | **carried**       | the same Action, untouched, with a carry count                  |
| Work that genuinely resets each period -- invoicing, a weekly review, an oil change | **recurring**     | `action_templates` (`cadence`, `next_occurrence_on`, `goal_id`) |
| The projects themselves                                                             | **standing**      | the initiative, which is an entity and never needs copying      |

All three already have somewhere to live. Rolled together into "copy last week"
they need new machinery and lose the distinction that makes the week readable:
what stalled, what came round again, and what is genuinely new.

**The week stops being a container and becomes a checkpoint.** The initiative
holds a living list; the weekly pass is where the owner marks what is done,
drops what is dead, and adds what is new. That is the same ten minutes, minus
the retyping.

### The one thing copying does better

A deliberate reset. Sometimes the right move is to declare weekly bankruptcy on
a stalled initiative and rewrite its list from scratch. That is worth an
explicit action -- clear what is open, with a reason recorded -- rather than a
copy mechanism used every week to get it.

## What Planner AI already has

More than it looks. The plan is already a hierarchy rooted in direction:

```
Vision -> yearly Goal -> quarterly Goal -> monthly Action -> weekly Action
```

| The ritual                 | Planner AI today                                             | State                      |
| -------------------------- | ------------------------------------------------------------ | -------------------------- |
| The weekly folder          | the weekly planning horizon                                  | exists                     |
| Checking a task off        | `action.status.v1`, `completed_at`                           | exists                     |
| Cleaning up the week       | Weekly Review, `review.complete-weekly.v1`                   | exists                     |
| A task's link to direction | `actions.goal_id`, `goals.parent_goal_id`, `goals.vision_id` | exists                     |
| Nested tasks               | `actions.parent_action_id`                                   | **stored, not reachable**  |
| The project itself         | nothing durable and ongoing                                  | **missing**                |
| A suggested breakdown      | `ai_proposals` wrapping `action.create.v1`                   | mechanism exists, no flow  |
| What the week produced     | `reviews.reflection_markdown`                                | freeform, nothing computed |
| Definition of done         | `goals.target_value` / `unit`, `description_markdown`        | partial                    |

Two gaps are real. Everything else is a surface on machinery that already runs.

## Gap 1: nesting is stored but unreachable

`actions.parent_action_id` is a plain self-referencing foreign key
(`canonical_core.sql:124,143`) with **no constraint tying a child to a
different horizon**, and the database already walks it to arbitrary depth --
`planning_snapshot_undo.sql:264` joins a recursive `descendants` CTE so that
archiving and undo cascade through a whole subtree.

The interface is what assumes one level. `app/actions.ts:468` sets
`parentActionId` only when creating a weekly Action, and only to its monthly
parent; `actions.ts:342` then reads that same column back as `monthly_id`. So
the one relationship the schema offers has been spent on the monthly-to-weekly
rollup, and there is no way to put a task under a task.

This is the same shape as the Notes tree before it got disclosure controls: the
storage was always a tree, and the screen flattened it.

**Recommendation: stop reading `parent_action_id` as "the monthly one".** It
already means "this Action sits under that Action". A weekly Action under a
weekly Action is the same relationship one level further down, and the cascades
are already recursive. What needs to change is the read path and the interface,
not the schema:

- derive the monthly rollup by walking up to the nearest ancestor on the
  monthly horizon rather than assuming the immediate parent is it;
- give the planner the same disclosure, indent and outdent controls Notes has,
  against the same `action.move.v1` that already reparents;
- bound the depth (four is more than the export uses) so the recursive undo
  functions keep a predictable cost.

## Gap 2: an initiative is not a goal

A Goal in Planner AI is built to be _finished_: it has `due_on`, `achieved_at`,
`target_value`, and the Review asks whether it was reached. "Real estate agent
business" and "Planner AI" are never reached. Filing them as Goals means being
asked every quarter whether the business is done.

They are also not Notes. A Note holds writing; these hold _work_, and that work
has to reach Today, This Week, and the Review.

**Recommendation: an Initiative is a Goal with a different kind, not a new
table.** Add `goals.kind` (`outcome` by default, `initiative`), where an
initiative has no `due_on`, is never `achieved`, and moves between
`active`, `paused` and `closed`. That inherits, at the cost of one column and
one migration:

- the whole goal hierarchy and its link to Vision (`vision_id`,
  `parent_goal_id`);
- `note_goal_links`, so the project's page and its work are the same thing;
- `actions.goal_id`, so every task already knows its initiative;
- Horizons, Review and the planner UI, each of which needs only to filter.

A new table would duplicate every one of those.

## The features asked for, against that shape

### A suggested breakdown when an initiative is created

`ai_proposals` already wraps an `operation_id` with `input_json`, a `batch_id`,
`status` and `applied_at`, and the capture flow already turns a batch into real
records atomically. A breakdown is **a batch of proposed `action.create.v1`**
against the new initiative -- no new machinery, one new prompt and one new
entry point.

It must stay a proposal. The owner accepts, edits or discards each line before
anything is written, exactly as capture proposals work today, and it must be
usable with AI switched off, which means the initiative is fully usable with an
empty task list.

### Major tasks and subtasks

Gap 1. Nothing else.

### An analysis of the week

`reviews.reflection_markdown` is freeform: the owner writes the week up by
hand. Everything needed to compute the other half is already recorded --
`completed_at`, `status`, `drop_reason`, `blocker_text`, `scheduled_on`, and
`action_schedule_history`.

The Review should open with what actually happened, per initiative, before it
asks for a reflection: completed, still open, dropped and why, and carried --
the count of times a task has been rescheduled, which is the number that
exposes a task nobody is ever going to do. Computed from Operations, not
written by a model, so it works with AI off and cannot be wrong.

### A definition of done, and the line to direction

`goals.target_value` / `unit` express a measurable target, and
`description_markdown` holds prose, but nothing says _what finished looks like_
in words on either a Goal or an Action.

For an initiative, "done" is the wrong question -- the right one is **what good
looks like this quarter**. Proposal: one `definition_of_done` field on goals,
required for an `outcome` and optional for an `initiative`, shown at the top of
the initiative and quoted in the Review.

The line to direction already exists and only needs showing: an Action knows its
Goal, a Goal knows its parent and its Vision. The initiative page should render
that chain, and the Review should group by it, so the answer to "why am I doing
this" is on screen rather than reconstructable.

## The weekly pass

This is the feature, and everything else exists to make it possible. One screen,
one initiative at a time:

- **Done this week** -- what completed, with its subtasks.
- **Still open** -- the carried list, each item showing how many weeks it has
  been carried. Anything at three or more is offered for dropping first,
  because that is the number that says nobody is going to do it.
- **Came round again** -- what the recurrence templates produced.
- **New** -- one line to add, filed under the initiative, nested where it
  belongs.

Every count is computed from records that already exist. `completed_at` and
`status` give the first; `action_schedule_history` gives the carry count, and it
already records `previous_horizon_id`, `new_horizon_id`, `reason` and even
`review_id`, so a carry made during a Review is already attributable to it.
Nothing here needs a model, which is what keeps the ritual working with AI off.

## The screen

This is a refit of `/review`, not a new surface. That route already lists
unfinished Actions and asks for a decision on each (`weekly-review.tsx:186`);
what it has never shown is what the week _finished_, which is the first thing
the owner wants from it. Mockup: [The Weekly Pass](https://claude.ai/code/artifact/f91b55fe-37ff-4e99-8923-726e4647062e).

### Shape

One column of initiatives, one sticky rail for next week.

```
Week of 8-14 September
[ finished 14 ] [ open 9 ] [ stalled 3 ] [ recurred 5 ]

+-- TEK Systems - Amazon ------------------+  +-- Next week ------+
|  Vision > Steady income > Q3 Land a role |  |  One line: what   |
|  Good this quarter: a signed contract,   |  |  would make the   |
|  or a clear no so the time goes elsewhere|  |  week worth it?   |
|                                          |  |                   |
|  FINISHED  3                             |  |  3  TEK Systems   |
|    the week's completions, quietly       |  |  2  1679          |
|                                          |  |  1  Planner AI    |
|  STILL OPEN  2                           |  |  0  Real estate   |
|    Wait for a new start date  [4th week] |  |                   |
|    > four weeks: waiting is not a task   |  | [Start next week] |
|                                          |  +-------------------+
|  + Add to this initiative                |  |  Reflection       |
+------------------------------------------+  +-------------------+
```

### The decisions that make it cheap

**Finished leads.** Each initiative opens with what closed, then what is still
open. The order answers the question the owner came to the screen with.

**Keep is the default, and most items need no decision at all.** Today's Review
asks the owner to resolve _every_ unfinished Action, which is the weekly tax
this design exists to remove. Once work carries rather than being copied,
staying open is free and silent. Only items carried three weeks or more are put
in front of the owner for a decision. That single change is most of the saving.

**The carry count is the primary signal**, quiet at one or two weeks and amber
at three or more. It is the only number that says nobody is ever going to do
this, and it exists _because_ nothing is copied.

**A stalled item gets a reason, not just a flag.** "Wait for a new start date,
4th week" is worth naming as what it is: waiting is not a task, because it has
no next action the owner controls. An initiative with weeks of no movement is
offered **pause** rather than drop -- pausing stops it appearing in the weekly
pass and keeps everything filed under it. That is the owner's "clean it up"
step, made explicit and reversible.

**Direction is on screen, not one click away.** Each initiative header carries
its chain -- Vision, yearly Goal, quarterly Goal -- and its definition of done
in plain words. Dropping something is only defensible when the criterion is
visible at the moment of dropping.

**Planning is the exit from reviewing.** The rail is where next week gets its
one-line intent and its counts; the primary control reads `Start next week - 6
carried`. There is no separate trip to a planning screen, because the moment
the owner knows what to plan is the moment they have just finished looking at
the week.

### Still open in the design

- Whether **Finished** collapses to a count once it has been read, or stays
  expanded. It is the answer to the owner's first question, and also the part
  that grows largest.
- Whether the reflection belongs in the rail or as a full-width final step
  before the week closes.

## Build order

Each step is usable alone and none blocks on AI.

1. **Carried work, and the carry count.** Stop treating the weekly horizon as
   where an Action lives; show an initiative's open list and how long each item
   has been sitting. This alone removes the retyping, and it is the step the
   whole design rests on.
2. **Nesting** -- read the monthly rollup by ancestor walk, then add disclosure,
   indent and outdent to the planner. Pure interface over `action.move.v1`.
3. **Initiatives** -- `goals.kind`, the status set, and an initiative page
   listing its open work against its definition of done.
4. **The weekly pass** -- the four-part screen above, per initiative.
5. **Recurring work made visible** -- `action_templates` already generates it;
   surface and edit it from the initiative, so "every week I invoice" is stated
   once instead of retyped.
6. **Definition of done** -- the field, on the initiative page and quoted in the
   weekly pass, as the criterion for dropping.
7. **Suggested breakdown** -- a proposal batch of `action.create.v1`, last,
   because it is the only step that needs a provider. A new initiative with an
   empty list must be fully usable without it.

## Open questions

- **Priority is not a container.** "Urgent important tasks" and "Not urgent" sit
  at the same level as the businesses in the export, but they are not projects
  and modelling them as such would give a task two homes. Priority belongs on
  the task, and Today's five-item cap is where it should bite. Worth settling
  before step 4.
- **What proportion of a week genuinely recurs** versus carries. It changes
  whether step 5 is a convenience or the main event.
- **Where a task with no initiative goes.** "Oil change" is real work and
  belongs to no business. Either a default personal initiative, or Actions keep
  being allowed a null `goal_id` as they are today.
