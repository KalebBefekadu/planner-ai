# Planner AI Product Rebuild Plan

Status: **Execution authority for the personal-dogfood release.** This replaces the older feature-list roadmap. [Status](status.md) is the factual record of what is complete.

## The Product We Are Building

Planner AI is a private personal operating system: a calm workspace for knowledge, a dependable planner for action, and an AI assistant that can use the same safe capabilities as the interface.

The target experience has two connected modes under one brand and one authenticated application:

- **Workspace** is document-first: pages, notes, imports, search, links, projects, and eventually graph and canvas views.
- **Planner** is action-first: Today, week, calendar, horizons, review, and vision.
- **AI** is an assistant inside both modes. It proposes and carries out approved Operations; it never becomes a separate product or a second source of truth.

The supplied Workspace and Planner reference screens are the visual and interaction target. `/preview` remains intact as a reference only; no new product behavior is built there. It is retired only after the real app covers the same flows with real data.

## Non-Negotiable Decisions

1. One authenticated Planner AI application, one canonical data model, one versioned Operations layer.
2. Every visible control must work on real user data or be absent. We will not ship decorative Graph, Canvas, database, or AI controls.
3. Every page is designed and tested as a complete vertical slice: loading, empty, populated, edit, error, offline/degraded, and mobile states.
4. Workspace and Planner share a global rail, workspace switcher, command/search entry point, typography, color tokens, icon language, and responsive rules; their contextual sidebars differ by mode.
5. AI enhances the normal workflow. Capture, editing, planning, import, export, and recovery remain usable when no provider is available.
6. The initial success criterion is personal daily use and a safe Notion migration, not feature-count parity with Notion or Obsidian.

## Delivery Gates

### Gate 1: Brand And Application Frame

**Outcome:** the real app has a recognisable Planner AI identity and the durable layout needed by every screen.

- `BR-01` Establish the brand system: Planner AI wordmark and mark usage, product voice, icon rules, and a restrained palette. The visual character is clear, grounded, warm, and serious rather than generic productivity software.
- `BR-02` Establish type, spacing, elevation, border, focus, motion, and semantic status tokens. Use an editorial display face for page and planner titles and an efficient sans-serif for the interface.
- `BR-03` Build shared primitives: global rail, workspace switcher, command/search trigger, contextual sidebar, breadcrumb/top bar, buttons, menus, tabs, fields, empty states, feedback, and mobile navigation.
- `BR-04` Build the cover and page-identity system: optional cover visual, icon or emoji, title, metadata, favorite state, and properties. Presentation metadata stays separate from Markdown content and is backed by an owned, permissioned model.

**Exit test:** the real authenticated app, at desktop and mobile widths, visibly uses this system on Notes, Planner, onboarding, settings, and import. No page uses the old shell.

### Gate 2: Workspace That Replaces Daily Notes

**Outcome:** a real document experience good enough to start moving personal knowledge out of Notion.

- `WS-01` Replace the current Notes route with the Workspace shell: favorites, workspace tree, search, contextual navigation, and document header.
- `WS-02` Make the document view real: Markdown editing, autosave and save state, hierarchy, title/icon/cover/properties, favorite, links, backlinks, and clear recovery feedback.
- `WS-03` Finish reliable capture and import entry points inside Workspace. A user can create a page, capture a thought, import a small Notion export, see exactly what succeeded or failed, and reopen the result.
- `WS-04` Add project/collection views only for existing typed data. Build Graph and Canvas only after links and typed relationships have an interaction model, persistence, and tests.
- `WS-05` Validate the Workspace on a representative real Notion sample before any full migration.

**Exit test:** a user can create, edit, find, import, export, and recover their own notes in the real app without AI or `/preview`.

### Gate 3: Planner That Connects Direction To Today

**Outcome:** the planner has the same visual quality as the target screen and works against canonical goals, actions, and captures.

- `PL-01` Replace the current Planner shell with its contextual navigation: Today, This Week, Calendar, Action Inbox, Weekly Review, Goals and Horizons, and Vision. Calendar must use planner navigation only, never Workspace navigation.
- `PL-02` Build the real Today screen: date, outcome limit, capacity/energy summary, actionable task list, realistic schedule, capture entry point, and the visible direction link.
- `PL-03` Build the hierarchy views: Week, Month, Quarter, Year, and Vision. Each view must show real relationships and allow navigation, creation, editing, and completion.
- `PL-04` Build Calendar and Weekly Review as real planning flows, including explicit rollover and undo/recovery behavior.
- `PL-05` Connect Workspace objects to planning objects when the user chooses, without forcing every note into the plan.

**Exit test:** a user can capture a task, connect it to a goal, select it for today, complete or defer it, and review the result at week end. The route has desktop, mobile, keyboard, empty, failure, and data-backed browser coverage.

### Gate 4: Migration-Ready Personal Dogfood

**Outcome:** Planner AI can become the user's daily system without risking their existing information.

- `MG-01` Build Notion export preflight: accepted formats, content inventory, duplicates, unsupported blocks, attachment limits, and a dry-run report before any write.
- `MG-02` Build resumable import and reconciliation: clear item-level results, stable source references, retryable failures, duplicate policy, and an import summary.
- `MG-03` Prove Markdown export, encrypted backup, restore to an isolated project, and account-scoped access before importing anything irreplaceable.
- `MG-04` Run a staged personal migration: a small pilot workspace, daily use for notes and planning, issue logging, correction, then wider migration.
- `MG-05` Deploy a private Vercel environment only after the real Workspace and Planner core pass production-like browser smoke tests.

**Exit test:** a representative Notion workspace has a successful preflight, a recoverable import, an export, and an independently verified restore. Planner AI is used daily for two weeks without returning to Notion for core notes or planning.

### Gate 5: Governed Intelligence And MCP

**Outcome:** AI and external clients are genuinely useful because they have the same boundaries as the product.

- `AI-01` Complete provider-independent roles for chat, structured analysis, transcription, and retrieval with cost, timeout, failure, and fallback controls.
- `AI-02` Expose contextual assistant actions on Workspace and Planner that create explicit, reviewable Operation proposals. The UI always has the equivalent manual action.
- `AI-03` Add durable conversations, provenance, editable context, memory controls, and AI-exclusion rules.
- `MCP-01` Ship a narrow authenticated read-only MCP catalog backed by the same Operations layer.
- `MCP-02` Add reversible writes only after OAuth, user consent, approval, rate limit, audit, revocation, and cross-client contract tests are complete.

**Exit test:** an AI outage does not block daily work; every AI or MCP effect is authorized, attributable, observable, and recoverable.

## First Ten Build Tickets

The next work is deliberately ordered. We do not jump from a sidebar tweak to Graph, Canvas, or MCP.

1. Audit the current authenticated shell, routes, and duplicate visual systems; record the exact components to replace and freeze `/preview` feature work.
2. Implement the Planner AI brand tokens and typography in the real application, with visual regression baselines.
3. Replace the existing authenticated frame with the global rail, workspace switcher, top bar, and responsive navigation.
4. Build contextual Workspace navigation and move real Notes into that frame.
5. Add the permissioned page-presentation metadata model and Operations required for cover, icon, favorite, and properties.
6. Complete the real Workspace document page: edit, save state, hierarchy, capture/import entry, and recovery states.
7. Build the contextual Planner navigation and move real Today into the same frame.
8. Deliver the real Today screen and its action, schedule, and direction interactions.
9. Deliver Week, Calendar, Horizons, Vision, and Review as connected, data-backed planner flows.
10. Build the Notion migration preflight and run the first small, recoverable import pilot.

## Quality Bar And Working Method

Each ticket is complete only when it has a real route, canonical data and Operations, authorization, empty/loading/error states, desktop and mobile visual review, keyboard access, focused automated tests, and no lost user input on failure. Changes are delivered as complete vertical slices, not as prototype-only fragments.

We will take one finished screen family at a time: shared frame, Workspace, then Planner. After each gate, we compare the real product at desktop and mobile widths against the target experience, test the daily workflow, fix the gaps, and then proceed. This is how the product converges instead of becoming a collection of attractive but disconnected pages.

## Deferred Until The Foundation Is Proven

Team collaboration, granular sharing, client portals, public forms, full relational databases, graph, canvas, local-first synchronization, community plugins, broad automations, and write-capable external MCP are valuable later capabilities. They are not part of the personal-dogfood release because they would dilute the work needed to replace daily Notes and planning first.
