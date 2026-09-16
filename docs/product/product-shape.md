# Two pillars, one spine

Status: **accepted product direction.** Supersedes the discarded
`workspace-first.md` draft. The [roadmap](../roadmap.md) remains the execution
authority: the single-owner personal MVP and seven-day dogfood finish before
shared Workspaces or the post-MVP stages in this document. Engineering
prerequisites are tracked in the
[improvement program](../engineering/improvement-program.md).

---

## The decision, in five lines

**Planner AI is a personal workspace with two pillars: Knowledge and Planning.**

- **Knowledge** is the main pillar and the front door — pages, Markdown, links, backlinks, graph, search, files, light structure.
- **Planning** is a co-equal pillar, not a module inside Knowledge — Vision, Goals, Today, Week, Review.
- They are separate pillars in the navigation and **one product underneath**: one logical object model, one search, one link graph, one Operations layer, one trash. This does not imply one generic database table.
- The personal MVP serves **one individual**. After dogfood, the same shape expands to families and small teams without adopting an organization's permission model.
- It models **Obsidian's openness**, not Notion's org chart.

---

## What I got wrong, and why you are right

My previous draft argued the planner should dissolve into a saved view over Actions
living on pages. That is wrong, and the schema shows why.

Planning has state that exists nowhere on any page:

| Table                     | What it holds that a page cannot                        |
| ------------------------- | ------------------------------------------------------- |
| `reviews`                 | whether a week is **closed**                            |
| `review_action_items`     | the decision made about each piece of work in that week |
| `planning_horizons`       | the periods themselves                                  |
| `action_schedule_history` | every time a thing moved, and why                       |

"This Action has been carried five weeks" is not a property of a page. It is derived
from a sequence of closed reviews. **A saved query cannot hold a ritual.** A view
can show you Actions; it cannot know that you decided something about them on a
Sunday. Folding planning into Knowledge would have quietly deleted the only
mechanism in this product that nobody else has.

So: two pillars. You were right and the draft is discarded.

---

## The one thing I still hold: one spine

Two pillars side by side is the correct architecture. **Two pillars with no spine
is the failure mode**, and it is the specific way Notion is bad. In Notion your
Actions database and your pages are technically linkable and practically divorced:
the Action knows a page ID, the page knows nothing, and within a month you are
maintaining two systems that describe the same work.

The pillars must share:

1. **One object model.** A page and an Action are different things, but they live in one graph, under one workspace, with one version/undo contract.
2. **One search.** `notes.search_vector` already weights title above body; Actions, Captures and pages resolve in one result list, not three.
3. **One link graph.** `note_links` already carries a `relation_type` — `related`, `supports`, `contradicts`, `continues`. That is richer than an Obsidian wikilink. Tasks join that graph; they do not get a parallel one.
4. **One Operations layer.** Every mutation in both pillars is a versioned Operation with a contract, a receipt, and undo. This already exists and is the most valuable thing in the repository.
5. **One trash and one history.** A person recovers a deleted thing in one place.

And exactly **one deliberate seam**, narrow enough to state in a sentence:

> An Action may point at a page. A page shows the Actions that point at it.

`actions.source_note_id` and `note_action_links` already exist. The seam is built.
It just is not surfaced.

That is the whole of the integration. Nothing else crosses. Resist every future
request to make the pillars know more about each other than this.

---

## Three collisions, decided

### 1. "Model Obsidian" vs. cloud-authoritative Postgres

These are in direct conflict and it needs saying plainly. Obsidian's promise is
_your files, on your disk, offline, no lock-in_. This product is 28 RLS-protected
tables in Supabase. **You cannot have Obsidian's architecture and this
architecture.**

You do not need to. What people actually use from Obsidian is not the local file —
it is what the local file guarantees: links that work, a graph you can see,
Markdown that is not a proprietary blob, and the certainty that you can leave.

**Decision: deliver Obsidian's ownership _guarantee_ without Obsidian's
architecture.**

- **Round-trip Markdown.** `export-vault.ts` already writes a vault out. Today the settings page admits "nothing here imports back." That sentence is the lock-in. Export must become **re-importable**, and the round trip must be a test, not a claim.
- **Folder sync as the escape hatch.** A workspace continuously mirrored to a folder of `.md` files the person owns. Read-only mirror is enough; two-way sync is a conflict-resolution project and is not in scope.
- **Links, backlinks and graph as first-class surfaces**, not a settings toggle.
- **No plugin API.** A small minority want one, and serving them well would mean a second product surface with its own security model.

Offline-first is explicitly **not** promised. Say so on the marketing page rather
than implying Obsidian parity and losing trust on first use.

### 2. Notion's databases vs. Obsidian's links — which is the foundation?

You said model Obsidian more. That orders these, and they cannot be co-equal
because one has to be the substrate.

**Decision: the link graph is the foundation. Structure is a layer on top of it.**

Concretely: a page is the primitive. Pages can have **typed properties** (status,
tag, date, number, relation-to-page). A "database" is **a saved view over pages
that share a property shape** — filtered, sorted, rendered as table, board or
calendar. It is not a separate container with its own schema.

This is the Obsidian-with-Dataview model rather than the Notion model, and it is
correct for this audience for three reasons: it needs no new container type, every
page stays a page and stays in the graph, and it degrades gracefully — a view that
breaks leaves you with pages, not orphaned rows.

**Formulas and rollups are out** until something specific demands them.

### 3. Families and small teams — how much permission?

This is the largest item in your new framing and it is currently blocked at the
root:

```sql
create table public.workspaces (
  owner_user_id uuid not null references auth.users(id),
  ...
  unique (owner_user_id)   -- ← one workspace per human, one human per workspace
);
```

There is no members table. **28 tables carry RLS, and `owner_user_id` appears 237
times across the migrations — with no helper function to swap.** Every policy
inlines the ownership check. Multi-user is not a feature; it is a rewrite of the
authorization layer, and it gets more expensive with every table added.

**Decision: prepare the authorization seam during personal-MVP hardening, then
build shared Workspaces immediately after dogfood, with exactly one role and no
permission matrix.**

- A `workspace_members` table; a person may belong to several workspaces.
- **One role: member.** Everyone in the workspace sees and edits everything. The only asymmetry is the owner, who can invite, remove and delete the workspace.
- Owner checks first move behind a small, security-reviewed helper while the
  product remains single-owner. The membership migration then changes that seam
  instead of rewriting every policy at once.
- Every membership-aware RLS predicate uses **one function** —
  `public.is_workspace_member(workspace_id)` — so later permission changes are
  localized.
- No guests, no page-level permissions, no roles, no approval chains.

This fits a family and a small team working on real projects, and it stays simple
because there is nothing to configure. Nothing degrades as a workspace grows — one
flat role scales technically without trouble. What changes with size is what people
want: above roughly a dozen people, most groups start asking for roles, guest
access and page-level permissions, and that is the product we are choosing not to
optimize for. Anyone who outgrows this shape leaves with a complete export, not a
broken workspace.

**Sequence membership after personal dogfood and before the post-MVP Knowledge
schema work below.** The helper refactor may happen earlier, but it must preserve
the current one-owner behavior and pass the existing cross-owner tests.

---

## What is already true — do not rebuild it

Your instruction was to keep what works. This is what works, verified in the code:

- **The planner is already native, from scratch, and effective.** Versioned Operations, undo with snapshots and trash-create strategies, idempotency receipts, optimistic concurrency. The weekly ritual just landed: initiatives that are never "done", free carrying with visible age, a stall signal at three checkpoints, nesting four deep, definition-of-done wired to the vision chain. **The "built from scratch, integrated, highly effective planner" you asked for is the part that already exists.**
- **The Knowledge substrate is stronger than it looks.** `notes` has a real tree (`parent_note_id` + `sort_key`) and a generated `search_vector`. `note_links` carries typed relations. Tags, attachments, revisions, import from Notion, vault export — all built.
- **`notes-workspace.tsx` is 2,147 lines — the largest component in the app**, larger than the planner's 1,338.

The workspace is **not under-built. It is under-placed.** That single sentence is
why this is mostly a navigation, naming and schema-constraint problem rather than a
feature-building problem, and it is why the first stage below is cheap.

---

## What blocks the target

Four facts, all verified:

1. **The front door is a planning page.** `/` renders Today; its summary band is literally `aria-label="Planning summary"`.
2. **The rail spends two of four main slots on planning** — Home and Planner both land on Today. Planner's sidebar offers seven destinations, Workspace five, two of which are Activity and Trash.
3. **Onboarding demands a life vision before a first page.** Steps are `['Rhythm', 'Direction', 'First moves']`. And `goals.vision_id` is `NOT NULL`, so a person who skips the vision step **cannot create a project at all** — a bug, not a policy.
4. **`actions.horizon_id` is `NOT NULL`, and `planning_horizons.kind` allows only year / quarter / month / week.** Every Action must be filed into a dated period the instant it is created. There is no someday. _This is why planning feels inescapable:_ in a second brain a checkbox waits; here, writing something down means answering "which week?"

Point 4 is the load-bearing one. Points 1–3 are days of work.

---

## The post-MVP build sequence

Prerequisite: the personal MVP, the seven-day dogfood gate, and the release-critical
parts of the engineering improvement program are complete. Five stages follow.
Each has a gate — a thing that must be true before the next starts.

### Stage 0 — Make the pillars visible · days

|                                                                                                              |                                                     |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `/` becomes the Knowledge home: recent pages, favourites, capture box. Today moves to `/planner/today` only. | One route. Flips the product's first impression.    |
| Rail becomes **Knowledge · Planner · Search**. Home folds into Knowledge.                                    | Planning stops holding half the navigation.         |
| Onboarding becomes **Rhythm → First page → (optional) Direction**, skip as the quiet default.                | Nobody declares a vision before seeing the product. |
| `goals.vision_id` becomes nullable.                                                                          | Fixes a workspace that cannot create a project.     |
| "Capture inbox" and "Action inbox" get names that are not near-homonyms.                                     | Two queues, nearly one name.                        |

**Gate:** a new account reaches a blank page and writes something without meeting the word "goal".

### Stage 1 — Shared workspaces · 2–3 weeks

`workspace_members`, invitations, one role, and every RLS predicate moved behind
`is_workspace_member()`. Drop `unique (owner_user_id)`.

**Gate:** two accounts edit the same page, and a pgTAP test proves a non-member
sees nothing. Do this now, before the table count grows.

### Stage 2 — The spine · 2–3 weeks

|                                                                                                                      |                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **A `'someday'` horizon kind** (or nullable `horizon_id`). An Action can be written down and wait.                   | Removes the toll booth. The one schema change that changes how the product feels. |
| **Tasks inline on a page**, created and completed in place, via the existing `source_note_id` / `note_action_links`. | The checkbox-on-a-page primitive. Columns already exist.                          |
| **A page shows its Actions; an Action links back to its page.**                                                      | The seam, and the only one.                                                       |
| **Backlinks panel and link graph**, off `note_links`.                                                                | Obsidian's actual draw.                                                           |
| **Unified search** across pages, Actions and Captures in one result list.                                            | One spine means one search.                                                       |

**Gate:** a project can be run entirely from its page — write the context, add the
Actions, complete them — and the same Actions appear in the week without being entered
twice.

### Stage 3 — Structure · 3–4 weeks

Typed page properties. Saved views over pages sharing a property shape — table,
board, calendar. Filters and sorts persisted per view. Relation-to-page as a
property type.

**Gate:** the owner's top three Notion databases are rebuilt as views and nothing
essential is missing.

### Stage 4 — Ownership · 2–3 weeks

Round-trip Markdown: the vault export re-imports, with a test that exports,
re-imports and diffs to zero. Continuous folder mirror. A visible, honest statement
of what is and is not portable.

**Gate:** a full export re-imports into an empty workspace and reconciles item for
item.

---

## Explicitly out of this product-shape program

Named so they stop being reconsidered every few weeks.

- **Local-first and offline editing in this program.** Stage 4 delivers the ownership guarantee. True local-first remains a separately gated long-term decision and must not be implied by current marketing.
- **A plugin API in this program.** Sandboxed extensions remain a separately gated long-term direction, not a dependency of the Knowledge or Planning pillars.
- **Formulas and rollups.** Until a real workflow demands one.
- **Roles, guests, page-level permissions, comments, approvals.** Each one adds configuration to every screen it touches, and the value only arrives at a size we are not building for. Revisit if real users ask for a specific one.
- **Public pages and publishing.** A separate product decision, not part of this shape.
- **Renaming "Planner AI".** The name now undersells a two-pillar product, but it touches the shell, the manifest, the emails and the MCP surface. It is a real change and belongs on its own branch, not inside this work.

---

## What would reverse these decisions

- **If the owner's real Notion turns out to be mostly relations and rollups**, Stage 3 is bigger than scheduled and moves ahead of Stage 2.
- **If nobody is invited to a Workspace in three months after dogfood**, Stage 1 was premature — though the authorization helper remains worthwhile if its security and performance evidence are at least as strong as the current policies.
- **If a `'someday'` horizon produces a graveyard** — hundreds of Actions nobody revisits — then the `NOT NULL` was a feature, and the fix is a someday queue the weekly review actively surfaces rather than an unscheduled bucket.
- **If the weekly review goes unused for six weeks of genuine daily use**, the planning pillar is weaker than this document assumes, and "planner as a bonus" was right after all. That is the one piece of evidence that would overturn the whole shape.
