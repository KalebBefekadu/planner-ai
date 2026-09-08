# Planner AI Delivery Plan

Status: **execution authority.** [Status](status.md) records verified completion; [Product vision](product/vision.md) holds the longer-term direction.

## Goal

Ship one private, deployed Planner AI that its owner can use every day instead of Notion for personal notes and planning.

The personal-dogfood release succeeds when the owner can:

1. sign in and reach one coherent, branded application;
2. import a representative Notion export without silent loss;
3. create, edit, organize, search, export, and restore Markdown notes;
4. capture work, connect it to direction, plan Today and This Week, and complete a weekly review;
5. use those workflows when AI is unavailable;
6. recover the data from a verified backup.

This is the current delivery goal. The long-term goal remains an AI-native personal operating system with databases, graph, canvas, collaboration, plugins, local-first storage, GenUI, and broad MCP control. Those capabilities do not belong on the critical path to personal dogfood.

## Product Shape

One authenticated application has two modes:

- **Workspace:** documents, notes, captures, hierarchy, search, imports, and exports.
- **Planner:** Today, This Week, Calendar, Goals and Horizons, Vision, and Review.

Both modes share the Planner AI brand, global rail, workspace switcher, command/search entry, top bar, responsive rules, canonical data, and versioned Operations. AI is contextual inside both modes and cannot become a second product or data path.

`/preview` is frozen as a visual reference. It receives no new behavior and stays available until the real routes replace every accepted pattern.

## Preview Convergence Strategy

Keep the **route separate temporarily**, but unify the **implementation immediately**.

`/preview` currently contains fixture-backed screens. The authenticated product contains the real data, authorization, and Operations. Combining those files directly would make fixture assumptions part of production and slow every later change. Keeping two independent design systems would also keep creating drift.

Use this migration pattern:

1. Capture desktop and mobile reference screenshots for each accepted Preview screen.
2. Extract its tokens and reusable, data-agnostic components into the real shared design system.
3. Define a typed view model for each screen family. Preview fixtures and authenticated loaders may both satisfy that contract, but only authenticated routes can mutate data.
4. Build the authenticated route with shared components, real loading/error/empty states, and real Operations.
5. Compare the real route with the reference at desktop and mobile widths; close functional, visual, responsive, and accessibility gaps.
6. Mark that Preview screen superseded and remove its duplicate fixture implementation.
7. Delete the `/preview` route only after Workspace and Planner both pass parity and workflow gates.

This gives us one visual source of truth without pretending the prototype is production. Preview becomes a temporary component showcase and visual test fixture, not a second application.

## Critical Path

### 1. Brand And Real Shell

Deliver one reusable authenticated frame, not page-by-page styling.

- Inventory the Preview frame and map every accepted element to **reuse**, **rebuild**, or **discard**.
- Lock the Planner AI mark, wordmark, voice, color, typography, spacing, icon, focus, and motion rules.
- Extract shared, fixture-free components for the global rail, contextual sidebar, workspace switcher, command/search trigger, breadcrumb/top bar, assistant entry, and mobile navigation.
- Apply the frame to Workspace, Planner, onboarding, import, and settings.
- Remove old shell variants only after all real routes use the replacement.

**Done when:** Preview and authenticated routes use the same frame components, the authenticated desktop and mobile application matches the reference design language, and no real route uses the old shell.

### 2. Workspace And Notion Pilot

Finish the smallest trustworthy Notion replacement.

- Move real Notes into the new Workspace shell with favorites, hierarchy, search, and document navigation.
- Complete the real document surface: Markdown editing, autosave state, title, icon, optional cover, properties, links, backlinks, voice capture, and recovery feedback.
- Keep presentation metadata separate from Markdown and protect it with workspace authorization.
- Add Notion preflight, dry-run reporting, item-level import results, duplicate handling, retry, and unsupported-content reporting.
- Prove create, edit, search, export, re-import, and isolated restore on a representative sample.

**Done when:** the owner can safely move a small real Notion workspace into Planner AI and use it without `/preview` or AI.

### 3. Daily Planner Loop

Finish one complete direction-to-action workflow.

- Use Planner-only contextual navigation for Today, This Week, Calendar, Action Inbox, Review, Goals and Horizons, and Vision.
- Build Today from real data: limited outcomes, planned time, schedule, completion, deferral, and a visible link to direction.
- Connect Vision to yearly, quarterly, monthly, and weekly goals without duplicating objects for each view.
- Complete capture, scheduling, weekly rollover, review, Activity, and undo.
- Preserve input and useful error states during AI or network failure.

**Done when:** the owner can capture an action, connect it to a goal, plan it, complete or defer it, and review the week entirely through the real UI.

### 4. Private Deployment And Daily Use

Make the finished core safe enough to depend on.

- Apply the reviewed production migrations and deploy the canonical application privately.
- Verify authentication, workspace isolation, Notes, import/export, Planner, backup, and restore in the deployed environment.
- Run a staged migration: sample first, then a wider import only after reconciliation succeeds.
- Dogfood the product for seven consecutive days and fix workflow-blocking defects before expanding scope.

**Done when:** the deployed application completes all six goal outcomes and the owner can recover its data independently.

## After Personal Dogfood

Only after the four critical-path stages pass:

1. finish provider-independent AI, durable conversations, memory controls, evaluations, and graceful fallback;
2. ship authenticated read-only MCP, then reviewed reversible writes;
3. add typed databases and alternate views;
4. add graph and canvas over real relationships;
5. pursue stronger offline/local-first sync, collaboration, sharing, forms, portals, and plugins.

## Immediate Queue

Only one ticket is active at a time:

1. complete the real Planner daily loop: direct capture, goal connection, Today commitment, completion or deferral, and weekly review;
2. run a representative Notion pilot import and reconcile every imported, duplicate, and unsupported item;
3. close remaining authenticated Workspace and Planner parity gaps, then retire superseded Preview fixtures;
4. execute the approved production migration and private-deployment gates;
5. complete seven consecutive days of owner dogfooding and fix workflow-blocking defects.

The shared shell, single Notes tree, grouped Note details, persistent import report, Planner-scoped Today and Action Inbox, outcome-focused Today hierarchy, and real Goal direction band are merged through PR #111.

No implementation ticket is active. The next ticket must be the smallest real-data gap in item 1; do not add fixture-only schedule behavior. The Notion pilot remains a user-data gate, so Planner work may continue without weakening that gate.

## Definition Of Done

A ticket is complete only when it has real data and Operations, authorization, loading/empty/error states, preserved input on failure, keyboard access, desktop and mobile review, and focused automated coverage. A delivery stage also requires its full affected browser journeys and production-build visual checks.

## Speed And Token Rules

- Keep this file as the only execution sequence; do not create parallel plans.
- Keep [status.md](status.md) factual; update it only after evidence changes.
- Use TokenSave and targeted code reads before broad repository scans.
- Batch design-system changes by component family instead of making isolated CSS edits.
- Run formatting, types, and focused tests during a ticket; run broad suites at stage gates or when shared contracts change.
- Do not repeat product research unless a specific unresolved decision blocks implementation.
- Do not work in `/preview`, Graph, Canvas, databases, collaboration, plugins, or broad MCP while a critical-path ticket remains.
- Preview may change only when extracting shared components or removing a screen already replaced by a real route.
- Report only decisions, changed behavior, verification, and blockers.
