# ENG-00: current-contract inventory for the life-areas redesign

Baseline: `integration/dogfood` at `f90de1b`, 95 migrations applied in order.
This records what the schema and Operation manifest actually say today, so the
redesign slices change contracts deliberately rather than discovering them.

## What does not exist

No table, Operation, or read model represents a life category. The 95
migrations create 48 tables; none of them is `life_areas` or an equivalent.
Grouping today is available only as Note hierarchy or as words inside a title.

There is likewise no durable weekly commitment. `reviews` and
`review_action_items` record a *closed* week; nothing records the set of work a
person selected when they planned it, so "planned tasks completed" has no
denominator to divide by.

## The constraints the redesign has to move

These four are the load-bearing ones. Each is a real database constraint, not a
UI convention, so each needs a migration and a versioned contract change rather
than a component edit.

| Constraint | Where | What it forces |
| --- | --- | --- |
| `visions_one_active_per_workspace_idx` (unique partial index on `workspace_id`) | `20260816000200_canonical_core.sql` | One vision per workspace. A per-area vision is impossible until the index is scoped. |
| `goals.vision_id uuid not null` | same | Every Goal needs a Vision. `vision_required` is a live failure code in `stableFailure`. |
| `goals.horizon_id uuid not null` | same | Every Goal is pinned to one dated period; a Goal cannot span Q4→Q1 without being cloned. |
| `actions.horizon_id uuid not null` | same | Same for Actions. `action.create.v1` therefore requires `horizonKind` + `startsOn` + `endsOn`. |

`planning_horizons` itself is sound and worth keeping: `(workspace_id, kind,
starts_on)` is unique, `timezone_snapshot` is stored per horizon, and
`week_starts_on` lives on the workspace. Period identity is not the problem;
mandatory period *membership* is.

## What is reusable as-is

- **The Operation path.** `executeOperation` → `execute_ui_operation` →
  `dispatch_trusted_operation` → `public.operation_handler_for(id)` → one
  domain handler. `operation_handler_for` is a pure SQL function, and
  `operation_contracts.owning_domain` is written from it by trigger, so a new
  domain is a `when ... then` clause plus a branch, plus the matching
  `domain:` field in `operationDefinitions`. The parity unit test compares both
  sides without a database.
- **Idempotency and receipts.** Every handler takes an advisory xact lock on
  `(workspace, operation, key)`, returns the recorded `result_json` on replay,
  and writes an `operation_receipts` row with `undo_payload_json`. Copying that
  prologue verbatim is the right move; inventing a second one is not.
- **Notes.** `notes` already has `parent_note_id` with a composite
  workspace-aware foreign key, a cycle check, `sort_key numeric(24,12)`,
  `ai_excluded`, revisions, trash with `purge_after`, and a generated
  `search_vector`. A category's canonical page is an ordinary Note, and no
  second document engine is needed.
- **RLS shape.** Every workspace table follows the same three lines: force RLS,
  one `for select to authenticated using (workspace_id in (select id from
  public.workspaces where owner_user_id = auth.uid()))` policy, `revoke insert,
  update, delete ... from authenticated`. Writes only ever arrive through a
  definer handler. New tables must not deviate.
- **Composite foreign keys.** `unique (id, workspace_id)` on every table, and
  every reference is `(child_id, workspace_id) references parent(id,
  workspace_id)`. This is what makes a cross-workspace reference fail at the
  database boundary, which invariant 1 requires.

## Decisions recorded here

**One primary area plus related links.** `life_areas.id` is referenced by a
nullable `primary_area_id` on Goals, Actions, and Notes; additional
associations go in a typed `area_links` table when a surface needs them. This
is isolated in the association contract, so equal multi-area membership remains
adoptable later without reworking the area tree or its UI.

**The Vision record stays authoritative.** A category's vision is a `visions`
row with `area_id`, not text copied into the category's Note Markdown. The
canonical Note is for free writing. Two editable copies of the same words is
the failure mode being avoided.

**Archive is inherited, not cascaded.** `archived_at` is set on the area the
person archived. Descendant visibility is computed from ancestor state, so
restoring a parent restores the subtree while preserving children that were
archived individually. Nothing is written to descendant rows, so nothing has to
be unwritten.

**AI exclusion is inherited and resolved once.** `life_areas.ai_excluded`
applies to descendants. One resolver serves retrieval, summaries and context;
an item linked to an excluded area stays excluded when reached from elsewhere.

**Horizon nullability is deferred, not skipped.** Slices before ENG-08 project
existing horizon-pinned records into clearer views. Making `horizon_id`
nullable is its own migration with its own reader updates, because breaking
output nullability is a versioned contract change, not a cast.

## Verification available locally

The stack is one shared Supabase project named `planner-ai`;
`scripts/verify-local-database.sh` holds a lock around every reset, so
`npm run test:db` and `npm run types:generate` are safe to call and must not be
replaced with a bare `npx supabase db reset`. Generated types and the Operation
contract registry are both produced from a clean reset and compared in the
application suite, so a migration that adds a contract row and no TypeScript
definition fails a unit test rather than production.
