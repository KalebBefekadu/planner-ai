# Planner AI Delivery Roadmap

Status: **execution authority.** [Status](status.md) records verified facts. [Vision](product/vision.md) defines the destination. [Requirements](product/requirements.md) defines product behavior.

## Goal Hierarchy

### Final Product

Planner AI is an AI-native personal operating system that combines:

- Obsidian-style Markdown ownership, links, graph, canvas, offline use, and version-control friendliness;
- Notion-style databases, views, visual customization, forms, dashboards, and collaboration;
- a coherent Vision-to-Action planning system;
- a click-first interface plus assistants and external agents that use the same governed Operations.

This is the north star, not the current release scope.

### Current Delivery Goal: Personal MVP

Ship one private, deployed Planner AI that its owner can trust and use every day instead of Notion for personal notes and planning.

The MVP is complete only when the owner can:

1. sign in and use one coherent, branded application on desktop and mobile;
2. import a representative Notion export with an item-level reconciliation report and no silent loss;
3. create, edit, organize, search, link, export, and restore Markdown Notes;
4. capture a thought, connect an Action to a Goal, plan Today and This Week, complete or defer work, and finish Weekly Review;
5. ask the embedded assistant to perform the critical Note and Planner Operations with confirmation, evidence, Activity, and useful failure recovery;
6. connect an authenticated external AI client through the approved narrow MCP surface;
7. continue core work when AI is unavailable; and
8. recover the product data from a verified backup.

The MVP is for one owner. It is not yet an invite beta, team product, or public launch.

## Four Product States

| State              | Meaning                                                                                                                  | Source of truth                | Rule                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | -------------------------------------------------- |
| **Real app today** | Authenticated canonical routes backed by actual data and Operations. Approximately 78% of the personal MVP is evidenced. | `web/` and [Status](status.md) | All new product behavior lands here.               |
| **Personal MVP**   | The private Notion replacement and daily-planning finish line defined above.                                             | This roadmap                   | Current delivery target.                           |
| **Preview app**    | Fixture-backed visual reference for accepted Workspace and Planner patterns.                                             | `/preview`                     | No new product behavior or separate design system. |
| **Final product**  | The complete customizable, local-first, collaborative, agent-native operating system.                                    | [Vision](product/vision.md)    | Built only through gated post-MVP stages.          |

## Product Shape

The real authenticated application has two primary modes:

- **Workspace:** Notes, captures, hierarchy, search, import, export, and knowledge connections.
- **Planner:** Today, This Week, Calendar, Action Inbox, Goals and Horizons, Vision, and Review.

They share the Planner AI brand, global rail, contextual navigation, search/command entry, top bar, responsive system, canonical data, and versioned Operations. AI is contextual inside both modes and never becomes a second application or data path.

Onboarding is a dedicated pre-product flow. After completion or skip, the user enters the same real authenticated application.

## Preview Policy

Keep `/preview` temporarily separate from authenticated routes, but do not maintain it as a second product.

- Preview fixtures may satisfy shared typed view models, but they never write production data.
- Reusable visual tokens and fixture-free components belong in shared production modules.
- Each real feature ticket includes desktop and mobile comparison with its accepted Preview reference.
- When a real screen reaches functional, visual, responsive, and accessibility parity, remove its superseded Preview implementation.
- Delete `/preview` only after both Workspace and Planner pass their MVP workflow and parity gates.

The real app is always the eventual single source of truth.

## Delivery Sequence

### Stage 0: Foundation

Status: **complete.** The canonical schema, RLS, versioned Operations, Activity, undo, recovery-aware workflows, automated quality gates, shared authenticated shell, and core product routes exist.

### Stage 1: Daily Planner Loop

Status: **active.** Finish the smallest complete direction-to-action workflow using real data.

- Keep all daily routes inside Planner navigation.
- Create or capture an Action directly, connect it to a Goal, and commit it to Today or This Week.
- Complete, defer, replace, or mark blocked without losing schedule history.
- Carry deliberate decisions into Weekly Review and Activity.
- Match the accepted Preview hierarchy and responsive behavior without inventing fixture-only schedule data.

**Exit gate:** the owner completes the full loop through real UI and persisted Operations on desktop and mobile.

### Stage 2: Notion Replacement Pilot

Status: **product foundation complete; owner-data pilot pending.**

- Run preflight and dry-run on a representative Notion export.
- Reconcile every imported, duplicate, skipped, and unsupported item.
- Close blocking gaps in hierarchy, Markdown, links, properties, covers/icons, search, export, or restore.
- Compare the real Workspace with accepted Preview references and remove superseded fixtures.

**Exit gate:** the owner can move a representative workspace into Planner AI, use it for daily Notes, export it, and restore it without silent loss.

The pilot requires owner data. Stage 1 work continues while that gate is waiting, but the MVP cannot close without it.

### Stage 3: Core AI And MCP

Status: **foundations implemented; live certification pending.**

- Verify assistant parity for critical MVP Note, Capture, Action, Goal, Today, and Review Operations.
- Preserve confirmation, evidence, undo, Activity, and input during provider failure.
- Certify provider fallback, budgets, retention controls, and deterministic evaluations.
- Verify authenticated MCP discovery, least-privilege read access, selected reversible writes, revocation, and compatibility with one supported external AI client.

**Exit gate:** AI materially accelerates core workflows but is never required to complete them, and external access cannot exceed the same Operation permissions.

### Stage 4: Private Release

Status: **pending explicit production approval.**

- Apply reviewed pending migrations during a recorded maintenance window.
- Deploy the canonical app behind private access.
- Verify authentication, workspace isolation, Notes, import/export, Planner, assistant fallback, MCP revocation, backup, and restore in the deployed environment.
- Establish monitoring, alerts, cron ownership, and off-machine backup custody.

**Exit gate:** all eight MVP outcomes pass in the deployed environment with a documented rollback path.

### Stage 5: Seven-Day Dogfood

Status: **pending private release.**

- Use Planner AI as the primary personal Notes and planning system for seven consecutive days.
- Record workflow failures as focused defects, not speculative feature expansion.
- Fix every data-loss, access, recovery, or daily-workflow blocker.

**Exit gate:** seven consecutive days complete with no known severity-one defect and no need to return to Notion for an MVP workflow. This is the personal MVP finish line.

## After The Personal MVP

1. **Invite beta:** custom domain and email, operational security review, accessibility evidence, malware scanning, provider/SLO evidence, and support readiness.
2. **Structured workspace:** typed databases, relations, formulas, filters, and table/board/calendar/timeline/gallery views.
3. **Knowledge tools:** graph, canvas, stronger backlinks, and visual composition.
4. **Local ownership:** stronger offline-first behavior, filesystem/Markdown sync, conflict handling, and Git-friendly workflows.
5. **Collaboration:** sharing, permissions, real-time editing, forms, portals, comments, and assignments.
6. **Agent platform:** broader MCP, automations, integrations, sandboxed plugins, and carefully governed generative UI.

Each capability must first exist as a user-facing, authorized Operation before an assistant or external agent may control it.

## Immediate Queue

Only one Codex implementation ticket may be active:

1. implement `PL-05`: create an Action directly from Today, optionally connect it to a real Goal, schedule it for today, and commit it to focus through existing Operations;
2. run the Notion pilot as soon as representative owner data is available;
3. certify critical embedded-assistant Operations and one external MCP client;
4. close remaining Workspace and Planner Preview parity gaps;
5. execute the approved private-release gate and begin seven-day dogfood.

Completed convergence work through PR #111 includes the shared shell, Notes-owned tree, focused Note inspector, persistent import report, Planner-scoped Today and Action Inbox, outcome-focused Today hierarchy, and real Goal direction band.

## Ticket Definition Of Done

A ticket is complete only when it uses real data and Operations, enforces authorization, covers loading/empty/error states, preserves input on failure, supports keyboard use, passes desktop and mobile review, and has focused automated coverage. Broad browser and production-build checks run at stage gates or when shared contracts change.

## Delivery Discipline

- Keep this file as the only execution sequence and [Status](status.md) as the factual snapshot.
- Keep one Codex implementation ticket and at most one non-overlapping external audit active.
- Use TokenSave and targeted reads before broad scans.
- Batch shared design changes by component family.
- Do not repeat product research unless an unresolved decision blocks implementation.
- Do not build deferred frontier scope while a personal-MVP gate remains open.
- Do not modify production data, credentials, billing, or deployment settings without explicit approval.
- Report decisions, changed behavior, verification, and blockers rather than activity narration.
