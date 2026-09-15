# The Weekly Initiative Workflow

Status: **design proposal.** Not yet accepted into [the roadmap](../roadmap.md).

## The ritual being replaced

Every week the owner creates a folder for each project or business they have
running, writes that week's tasks underneath it, checks them off as the week
goes, and cleans the whole thing up at the end of the week.

From the Notion export the structure is:

```
Weekly
  Urgent important tasks          <- a grouping, not a project
  TEK Systems - Amazon            <- an ongoing concern
    Wait for new start date
    Reach out to baily
      wait to hear back           <- depth 2
  1679
    1679 Insurance
      Create invoice for engineering document
        Reach out to the company I spoke about   <- depth 3
  Planner AI
  Real estate agent business
```

Three properties matter and are easy to lose:

1. **The container outlives the week.** "Real estate agent business" is not
   finished; it recurs every week with new work under it.
2. **Work nests, three or four deep**, and the nesting is how a task keeps its
   context ("wait to hear back" is meaningless on its own).
3. **The week is a snapshot, not the home.** Tasks are rewritten each week; the
   project is the durable thing.

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

## Build order

Each step is usable alone and none blocks on AI.

1. **Nesting** -- read the monthly rollup by ancestor walk, then add disclosure,
   indent and outdent to the planner. Pure interface over `action.move.v1`.
2. **Initiatives** -- `goals.kind`, the status set, and an initiative page
   listing its open work.
3. **The weekly roll-forward** -- carry an initiative's unfinished work into the
   new week as one reviewed step, which is the manual part of the ritual.
4. **Computed review** -- what each initiative completed, dropped and carried,
   above the reflection.
5. **Definition of done** -- the field, on the initiative page and in the Review.
6. **Suggested breakdown** -- a proposal batch of `action.create.v1`, last,
   because it is the only step that needs a provider.

## Open questions

- **"Urgent important tasks" and "Not urgent" are not projects**, they are a
  priority grouping sitting at the same level as the businesses. Whether that
  becomes a real axis on an Action or stays a personal initiative is worth
  deciding from more of the export.
- **How much of a week is recurring work** versus new: `action_templates` and
  `recurrence_template_id` already exist, and if most weekly tasks repeat, step
  3 matters more than step 6.
