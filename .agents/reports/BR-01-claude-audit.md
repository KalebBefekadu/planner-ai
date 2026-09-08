# BR-01: Real-Shell Audit

Task: `.agents/tasks/BR-01-shell-audit.md`
Owner: Claude (independent read-only audit)
Branch: `claude/br-01-shell-audit` (base `integration/dogfood`)
Scope of evidence: `web/src` at this branch, which is byte-identical to `main` for `web/**`.
Nothing outside `.agents/reports/BR-01-claude-audit.md` was modified.

---

## 1. Current real shell entry points and ownership

### 1.1 There are three authenticated frames in the tree, selected at one place

`web/src/app/layout.tsx:39-85` is the single mount point. It branches three ways:

| Branch | Condition | Frame | Lines |
| --- | --- | --- | --- |
| V2 shell | `user && experienceV2` | `ExperienceShell` | `layout.tsx:54-61` |
| Legacy shell | `user && !experienceV2` | inline `.app-shell` + `NavLinks` | `layout.tsx:62-79` |
| Perimeter | no `user` | bare `children`; each auth page wraps itself in `PerimeterShell` | `layout.tsx:80-81` |

The V2 gate is `experienceV2EnabledForOwner` (`web/src/lib/experience-rollout.ts:27-39`), driven by `PLANNER_UI_V2` (`disabled` \| `enabled` \| `cohort`) and `PLANNER_UI_V2_COHORT_OWNER_IDS`. **Unknown or absent configuration falls back to the legacy shell** (`experience-rollout.ts:38`).

A second, independent flag `PLANNER_DATA_MODEL === 'canonical'` (`layout.tsx:27`, `36`) decides which navigation items exist at all. The two flags multiply: four shell/data combinations are reachable in production.

### 1.2 Ownership map

| Surface | File | Lines | Notes |
| --- | --- | --- | --- |
| Root mount, auth read, unread count | `web/src/app/layout.tsx` | `21-85` | server component; reads `notifications` count inline at `27-35` |
| Pre-paint theme stamp | `web/src/app/layout.tsx` | `45-50` | writes `documentElement.dataset.theme` from `planner-theme` |
| V2 frame (rail, sidebar, topbar, palette, mobile drawer) | `web/src/components/experience-shell.tsx` | `53-456` | client component, 456 lines, one file |
| V2 navigation model | `web/src/lib/experience-navigation.ts` | `1-140` | the only typed navigation contract that exists today |
| Legacy rail | `web/src/components/nav-links.tsx` | `19-77` | flat 11-item list, no area grouping |
| Perimeter (sign in/up/reset/update) | `web/src/components/perimeter-shell.tsx` | `26-68` | server component |
| Assistant entry | `web/src/components/assistant-dock.tsx` | `229-450` | launcher + `role="dialog"` panel; mounted twice in V2 (`experience-shell.tsx:220`, `:262`) |
| Theme control | `web/src/components/theme-toggle.tsx` | `35-60` | key `planner-theme` |
| Resizer (already shared) | `web/src/components/panel-resizer.tsx` | whole file | imported by both `experience-shell.tsx:22` and `app/preview/page.tsx:50` |
| Dialog behaviour (already shared) | `web/src/lib/use-dialog.ts` | whole file | imported by `experience-shell.tsx:23` and `app/preview/states.tsx:33` |
| Preview frame | `web/src/app/preview/page.tsx` | `128-561` | 2646-line file, fixture-backed |
| Preview access gate | `web/src/app/preview/layout.tsx` | `13-15` | `notFound()` unless `PLANNER_UI_PREVIEW === 'enabled'` |

### 1.3 Two facts that shape everything below

1. **Preview is already not a production dependency.** `app/preview/layout.tsx:14` returns 404 unless explicitly enabled, and the only code crossing the boundary today runs the other way: preview imports `@/components/panel-resizer` and `@/lib/use-dialog` (verified by grepping `app/preview/` for `@/` imports — those are the only two hits). Extraction must preserve this direction: shared code lives in `web/src/components` / `web/src/lib`, and `app/preview/**` imports it. Never the reverse.
2. **The e2e corpus only ever exercises the V2 shell.** `web/playwright.config.ts:66-71` builds and starts with `PLANNER_UI_V2=enabled PLANNER_DATA_MODEL=canonical PLANNER_UI_PREVIEW=enabled`. The legacy `.app-shell` branch — which is what an unconfigured production deployment renders — has **zero browser coverage**. Its only automated coverage is `web/tests/unit/experience-rollout.test.ts` proving the flag falls back to it.

---

## 2. Preview elements mapped to reuse, rebuild, or discard

"Reuse" = extract the Preview implementation nearly as-is into shared components.
"Rebuild" = the real route already owns behaviour Preview does not have; keep the real logic, restyle it against the extracted primitives.
"Discard" = out of the roadmap's four critical-path stages; leave frozen in `/preview` and delete with the route.

### 2.1 Frame

| Preview element | File:lines | Verdict | Replaces / lands in |
| --- | --- | --- | --- |
| Root grid `60px / sidebar / main / context` | `preview.module.css:90-110` | **Reuse** | replaces `.experience-shell` (`globals.css:174-180`); adds the 4th (context) column the real shell has never had |
| Skip link | `page.tsx:267-269`, `preview.module.css` | **Reuse** — already ported | `globals.css:6236-6252` (`.experience-skip-link`) is the same primitive |
| Icon rail + `RailButton` | `page.tsx:303-371`, `687-710` | **Reuse** | replaces `experience-shell.tsx:264-310` |
| Mobile bottom bar (`railMobileExtra`, `≤600px`) | `page.tsx:337-347`, `preview.module.css:2909`, `5031` | **Reuse** | **no equivalent exists** in the real shell; V2 mobile is a drawer only (`experience-shell.tsx:313-315`) |
| Mobile header | `page.tsx:270-301` | **Reuse** | replaces `experience-shell.tsx:247-261` |
| `ThemeControl` | `page.tsx:719-738` | **Discard implementation, reuse styling** | real `ThemeToggle` (`theme-toggle.tsx:35-60`) is the correct one — it stamps `<html>` and matches the pre-paint script; Preview's writes a *different* key (`page.tsx:99`) |
| Workspace switcher | `page.tsx:873-880` | **Rebuild** | real shell has an identity block with no switching affordance (`experience-shell.tsx:146-160`); one workspace per owner today, so build the component, wire it to a single-item list |
| `TreeSection` / `TreeItem` | `page.tsx:778-828` | **Reuse** | replaces the ad-hoc `<Link>` list at `experience-shell.tsx:201-217` **and** the Notes tree at `notes-workspace.tsx:212-230` |
| Quick search trigger (`⌘K`) | `page.tsx:882-888` | **Reuse** | consolidate with the topbar trigger at `experience-shell.tsx:333-351` — Preview has two entry points, the real shell has one |
| Sidebar primary action | `page.tsx:890-894` | **Reuse** | replaces `.experience-quick-action` (`experience-shell.tsx:181-199`) |
| Sidebar snapshot (progress) | `page.tsx:1013-1020` | **Rebuild** | fixture percentages; real data exists via `getGoalsHierarchy` |
| Sidebar footer links | `page.tsx:1087-1098` | **Reuse** | replaces `experience-shell.tsx:219-223` |
| Top bar + breadcrumb | `page.tsx:406-447` | **Reuse** | replaces `experience-shell.tsx:318-354`; Preview adds the context-panel toggle and `Share`, real adds nothing |
| `syncState` "Saved" | `page.tsx:429-431` | **Rebuild** | real shell hardcodes `Cloud workspace` (`experience-shell.tsx:352`); the real save state already exists per-surface at `notes-workspace.tsx:584` |
| `Share` button | `page.tsx:432-434` | **Discard** | sharing/collaboration is explicitly post-dogfood (roadmap "After Personal Dogfood" 5) |
| Context panel shell | `context-panel.tsx:30-93` | **Reuse (shell only)** | new shared slot; replaces the bespoke `.note-inspector` aside at `notes-workspace.tsx:881-1040` |
| `AiContext` | `context-panel.tsx:199-281` | **Rebuild** | real assistant is `assistant-dock.tsx:229-450` with evidence, claims, proposals, undo. Move that into the context slot; keep its logic |
| `PropertiesContext` | `context-panel.tsx:282-341` | **Rebuild** | fixture properties; the real Note has `title`/`aiExcluded`/`version`/`updatedAt` (`app/notes/actions.ts:9-18`) plus tags/attachments |
| `LinksContext` | `context-panel.tsx:342-388` | **Rebuild** | real links/backlinks already exist (`NoteKnowledgeContext.links`, `actions.ts:22-27`) |
| Floating AI button | `page.tsx:549-557` | **Reuse** | replaces the duplicate `AssistantDock` mount at `experience-shell.tsx:262` |
| `CommandPalette` | `states.tsx:538-620` | **Reuse (presentation)** | replaces `experience-shell.tsx:360-410`; keep the real router/search wiring at `experience-shell.tsx:136-142` |
| `CaptureComposer` | `states.tsx:621-724` | **Rebuild** | real capture is `dump-ui.tsx:69+` with voice, offline queue, recovery |
| `TabList` | `tab-list.tsx:7-59` | **Reuse** | replaces three hand-rolled tab strips: `.planner-horizon-tabs` (`planner-workspace.tsx:420-433`), `settings-tabs.tsx`, `review-tabs.tsx` |
| `EmptyState` | `empty-state.tsx:8-44` | **Reuse** | replaces `.empty-state` / `.inline-empty` (`globals.css:794`, `1614`) |
| `PerimeterView` | `perimeter.tsx:73-95` | **Reuse** | the real `PerimeterShell` (`perimeter-shell.tsx:26-55`) is already a faithful port; reconcile, do not re-port |
| `OperationProposal` | `operation-proposal.tsx:107+` | **Rebuild** | real proposals exist in `assistant-dock.tsx:365-391` and `review-ai-proposal.tsx` |
| `OfflineState`, `ConflictState`, `AiUnavailableState`, `PermissionDenied`, `ErrorState` | `states.tsx:42,81,152,195,222` | **Reuse** | already partly landed as `.state-page` (`globals.css:6297+`); finish the family |
| `TrashState`, `VersionHistoryState` | `states.tsx:272,343` | **Rebuild** | real `trash-manager.tsx` and `restoreNoteRevision` (`actions.ts:547`) exist |
| `ShareState` | `states.tsx:413-495` | **Discard** | post-dogfood |
| `PreviewIndex` | `page.tsx:589-686` | **Discard** | the showcase index; dies with the route |

### 2.2 Workspace (Preview → real Notes)

| Preview element | File:lines | Verdict | Real counterpart |
| --- | --- | --- | --- |
| `WorkspaceTabs` (document/table/graph/canvas) | `page.tsx:1103-1136` | **Discard for now** | table/graph/canvas are post-dogfood; keep the component, render one tab |
| `DocumentView` cover | `page.tsx:1154-1163` | **Rebuild** | roadmap stage 2 names "optional cover"; presentation metadata must stay out of Markdown |
| Page icon | `page.tsx:1165-1167` | **Rebuild** | same constraint |
| Title row + meta | `page.tsx:1168-1178` | **Rebuild** | real is `notes-workspace.tsx:551-582` (`.note-title-input`, breadcrumb) |
| Property strip | `page.tsx:1180-1196` | **Rebuild** | fixture-only; real properties are the `NoteView` fields |
| Lead paragraph, headings, callout grid, check list | `page.tsx:1198-1240` | **Discard as content; keep as Markdown render styling** | real body is source-authoritative Markdown (`notes-workspace.tsx:860-880`, `.markdown-preview` at `globals.css:2262+`). These are hand-written fixtures, not a block editor |
| AI callout | `page.tsx:1200-1212` | **Rebuild** | must come from the real assistant path |
| Block handle (`+` / grip) | `page.tsx:1241-1248` | **Discard** | implies a block editor; roadmap stage 2 is Markdown + guarded rich adapter only |
| Favorites tree section | `page.tsx:899-911` | **Rebuild** | roadmap stage 2 names favorites; no `favorite` field exists on `NoteView` (`actions.ts:9-18`) — needs schema work, so flag it, don't assume it |
| Workspace tree | `page.tsx:912-944` | **Reuse structure** | real tree is genuinely nested `<ul>` (`notes-workspace.tsx:212-230`) and correct; adopt Preview's `TreeItem` visuals onto the real recursive structure |
| `TableView` / `GraphView` / `CanvasView` | `page.tsx:1793,1887,1957` | **Discard** | post-dogfood (roadmap 3, 4) |
| `SearchView` | `page.tsx:2193-2254` | **Rebuild** | real `app/search/page.tsx` + `workspace-search` styles exist |
| `NotificationsView` | `page.tsx:2472-2578` | **Rebuild** | real `notifications-center.tsx` |
| `SettingsView` | `page.tsx:2403-2471` | **Rebuild** | seven real settings routes exist; `settingsContent` (`page.tsx:2255+`) is fixture copy |

### 2.3 Planner (Preview → real Planner)

| Preview element | File:lines | Verdict | Real counterpart |
| --- | --- | --- | --- |
| `PlannerView` header + `headerActions` | `page.tsx:1286-1304` | **Reuse** | replaces `.page-heading planner-workspace-header` (`planner-workspace.tsx:388-419`) |
| Horizon tabs (`Today…Vision`) | `page.tsx:1306-1318` | **Reuse via `TabList`** | real filter is `all \| GoalType` (`planner-workspace.tsx:47`, markup `:420-433`). **Semantics differ** — see §6.3 |
| Action composer | `page.tsx:1320-1345` | **Rebuild** | real `goal-composer` (`planner-workspace.tsx:514-551`) writes through Operations |
| Planner summary strip | `page.tsx:1347-1366` | **Rebuild** | real `.planner-overview` (`planner-workspace.tsx:469-492`) is already real-data |
| Progress ring | `page.tsx:1363-1365` | **Reuse** | no real equivalent; must be sized via CSSOM/classes, not a style attribute (§6.1) |
| Outcome list | `page.tsx:1368-1400+` | **Rebuild** | real `.plan-tree` / `.plan-item` (`planner-workspace.tsx:302-380`) carries status toggle, pace, undo |
| `PlannerCalendarView` | `page.tsx:1475-1581` | **Rebuild** | real `planner-calendar.tsx:37+` with scheduling Operations |
| `PlannerInboxView` | `page.tsx:1589-1682` | **Rebuild** | real `app/inbox` + `capture-proposal-queue.tsx` |
| `PlannerReviewView` | `page.tsx:1683-1792` | **Rebuild** | real `weekly-review.tsx:30+`, `period-review.tsx` |
| `GoalsHorizonsView` | `align-surfaces.tsx:88-208` | **Rebuild** | real hierarchy in `planner-workspace.tsx` |
| `VisionView` | `align-surfaces.tsx:227+` | **Rebuild** | real `vision-ui.tsx:14+` |
| Planner sidebar sections (Plan / Align) | `page.tsx:965-1022` | **Reuse** | replaces the flat planner list in `experience-navigation.ts:44-61` — Preview groups, the real model does not |
| `HomeView` | `page.tsx:2022-2131` | **Rebuild** | real `today-workspace.tsx:42+` |

### 2.4 Fixture data — the separation line

All Preview fixtures are confined to, and must never leave, these locations:

- `web/src/app/preview/preview-data.ts:36` (`previewPages`), `:300` (`files`), `:307` (`focusItems`), `:313` (`planRows`)
- `web/src/app/preview/page.tsx:1582` (`INITIAL_INBOX`), `:2134` (`searchResults`), `:2255` (`settingsContent`), `:1283` (`horizons`)
- `web/src/app/preview/context-panel.tsx:94` (`surfaceSuggestions`), `:175` (`documentSuggestions`)
- `web/src/app/preview/states.tsx:266` (`trashed`), `:336` (`versions`), `:496` (`paletteGroups`)
- `web/src/app/preview/align-surfaces.tsx:24` (`horizons`), `:41` (`goals`), `:209` (`principles`)
- `web/src/app/preview/operation-proposal.tsx:62` (`proposedChanges`), `:100` (`ledgerSteps`)
- `web/src/app/preview/perimeter.tsx:27` (`promises`), `:315` (`onboardingSteps`)

Authenticated data enters only through server loaders and Server Actions: `app/notes/actions.ts:88` (`getNotes`), `:109` (`getNoteKnowledgeContext`), `app/actions.ts` (`getGoalsHierarchy`, `getActionTemplates`, consumed at `app/planner/page.tsx:5-8`), and mutations exclusively via `executeOperation` (`app/notes/actions.ts:6`). **No extracted shared component may import from `app/preview/**` or from any `app/**/actions.ts`.** The enforceable rule: shared frame components take props only; fixtures and loaders are both callers.

---

## 3. Duplicate tokens, layout systems, and navigation implementations

### 3.1 Design tokens — two complete, non-overlapping palettes

| | Real | Preview |
| --- | --- | --- |
| Prefix | `--*` | `--v2-*` |
| Light source | `globals.css:1-61` | `preview.module.css:1-110` |
| Explicit dark | `globals.css:63-95` (`[data-theme='dark']`) | `preview.module.css:178-...` (`.previewRoot[data-theme='dark']`) |
| System dark | `globals.css:97-131` (duplicated block) | `preview.module.css:115-177` |
| Scope | `:root` (global) | `.previewRoot` (CSS Module, scoped) |

Concrete divergences that will change pixels on migration:

- Brand: `--brand: #13795b` (`globals.css:9`) vs `--v2-brand: #08745a` (`preview.module.css:39`). Dark: `#63c79f` vs `#5fc0a0` (`globals.css:65`, `preview.module.css:150`).
- Canvas: `#f5f5f0` vs `#f7f8f6`. Dark canvas `#15201d` vs `#101310` — Preview's dark is materially darker across the board (`surface #1e2b27` vs `#181c19`).
- Ink: `--ink: #16211e` vs `--v2-text: #171a18`.
- Border: `--line: #d9ddd6` vs `--v2-border: #d7ddd8`.
- Font family: `globals.css:156` is `Arial, Helvetica, sans-serif`. Preview defines `--v2-font-ui` (Inter stack), `--v2-font-display` (Source Serif 4), `--v2-font-mono` (`preview.module.css:86-89`). **The real app has no display or mono face and no Inter.** This is the single largest visual gap.
- Preview has ink tiers the real palette lacks: `--v2-text-soft`, `--v2-subtle`, `--v2-faint` (`:22-25`); surface tiers `--v2-surface-sub`, `--v2-surface-sunken`, `--v2-sidebar-deep` (`:5-8`); interaction tokens `--v2-hover`, `--v2-hover-strong`, `--v2-veil`, `--v2-veil-soft` (`:10-14`); media tokens `--v2-media-chip`, `--v2-on-media` (`:16-18`); page accents `--v2-green/blue/coral/yellow` (+ `-soft`) (`:57-64`); line heights `--v2-lh-tight/ui/read` (`:73-75`).
- The real palette has tokens Preview lacks: `--on-brand`/`--on-coral` (`globals.css:27-28`, `88-89`) — the on-colour pair dark mode depends on; `--experience-rail`, `--experience-sidebar` (`:30-31`); `--shadow`, `--shadow-sm`, `--shadow-lg` (`:14`, `:32-33`).

**Already identical, so free to unify:** the six-step type scale (`--fs-*` = `--v2-fs-*`, both `12/14/16/20/28/40`), the three radii (`4/6/8`), the three durations (`120/180/240ms`), `--ease`, and every functional colour (`link`, `ai`, `ai-soft`, `ai-line`, `success`, `warning`, `danger` and their softs) — `globals.css:17-26` vs `preview.module.css:44-54` are the same hex values. `--border-strong: #93a099` matches too.

The real palette also carries a compatibility alias block (`globals.css:52-60`: `--text`, `--text-muted`, `--line-strong`, `--accent`, `--teal`) added to repair undefined names. These are dead weight in a merged system and should be resolved and removed, not carried forward.

**Also duplicated: theme state.** `theme-toggle.tsx:7` uses key `planner-theme` and stamps `<html>` (matching the pre-paint script at `layout.tsx:48`). Preview uses `planner-preview-theme` (`page.tsx:99`) and stamps `.previewRoot` (`page.tsx:242`, `:263`). Two stores, two events (`planner-theme-change` vs `planner-preview-theme-change`), three near-identical `useSyncExternalStore` implementations (`theme-toggle.tsx:16-28`, `page.tsx:102-115`).

### 3.2 Layout systems — four, nested up to three deep

1. `.experience-shell` (`globals.css:174-558`) — 3 columns: rail / sidebar / work area. Sidebar width via `--experience-sidebar-w`.
2. `.app-shell` (`globals.css:560-682`) — legacy sidebar + `.app-main`. Still the default in an unconfigured deployment.
3. `.previewRoot` (`preview.module.css:90-110`) — 4 columns: `60px / var(--v2-sidebar-w,248px) / minmax(360px,1fr) / var(--v2-context-w,336px)`, with `grid-template-rows: 100%` and `overflow: hidden` so the work area scrolls internally.
4. `.notes-shell` (`globals.css:1962-1967`) — its own `264px / 1fr` grid with `min-height: calc(100vh - 96px)`, rendered *inside* the shell's work area (`notes-workspace.tsx:494-495`), and containing a third aside `.note-inspector` (`:881`). Under V2 that is **rail → shell sidebar → notes sidebar → editor → inspector**: five columns, two of them navigation, on one screen. This is the most severe structural mismatch with the reference, which has exactly one navigation sidebar and one context panel.

The `calc(100vh - 96px)` at `globals.css:1965` is a hardcoded assumption about the chrome above it. It was written for `.app-shell` and is wrong under `.experience-shell`, whose topbar is a different height.

**Responsive systems also diverge.** Real: `980px`, `900px`, `760px` (`globals.css:5341`, `6185`, `6287`, `5354`). Preview: `1180px`, `900px`, `820px`, `600px` (`preview.module.css:2845`, `2862`, `2909`, `4230`, `4881`, `5031`). Preview also drives layout from JS media queries — `MOBILE_BAR = '(max-width: 600px)'` (`page.tsx:2626`) plus compact/narrow subscriptions (`page.tsx:2612-2645`) — while the real shell is CSS-only. Note that the real shell's mobile collapse rules sit at `globals.css:5398-5400`, buried at the end of a `max-width: 760px` block whose other 40 lines are planner-calendar rules; that is a maintenance hazard on its own.

**Reduced motion** is handled once globally in the real app (`globals.css:6620-6628`, collapsing durations rather than removing them so `transitionend` still fires) and separately in Preview (`preview.module.css:3149`). Keep the real implementation; it is the better one and is already test-covered.

### 3.3 Navigation implementations — four

1. `experience-navigation.ts:29-140` — typed, area-based, canonical-flag-aware. **The only one worth keeping.** Six areas, per-area title/subtitle/items, `exact`/`prefix` matching (`:138-140`).
2. `nav-links.tsx:19-46` — flat legacy list; ordering built by array splicing (`:36-45`).
3. `experience-shell.tsx:75-96` (`primaryItems`) and `:97-112` (`commands`) — **hardcoded inside the component**, duplicating the destinations already described in `experience-navigation.ts`. `/inbox` appears in `primaryItems` (`:83` via `workspaceHref`), `commands` (`:107`), the workspace quick action (`:184`), the planner quick action (`:193`), and `experience-navigation.ts:70` and `:132`. The rail is sliced by index — `primaryItems.slice(0,4)` and `.slice(4)` (`:269`, `:287`) — so inserting an area silently moves Settings out of the rail footer.
4. `page.tsx:830-1101` (`PreviewSidebar`) — a `PrimaryView` union with per-view JSX branches and grouped `TreeSection`s the real model has no concept of.

Divergences in the destination set itself: Preview's planner sidebar offers Today / This week / Calendar / Action inbox / Weekly review / Goals & horizons / Vision (`page.tsx:967-1012`); `experience-navigation.ts:49-58` offers Today / Plan / Calendar / Vision / Weekly review — no "This week", no "Action inbox", no Plan/Align grouping. Preview's workspace tree is Favorites / Workspace / Views; `experience-navigation.ts:68-77` is Notes / Capture inbox / Conversations / Activity / Trash. **The two do not describe the same product.** Reconciling that list is a product decision the Codex lead should make before extraction, not during it (see §7 blocker).

---

## 4. Proposed shared component and view-model boundaries

### 4.1 Rule

```
web/src/components/shell/**   ← data-agnostic, props-only, no fixtures, no loaders, no Operations
        ↑                    ↑
app/preview/** (fixtures)    app/**/page.tsx (loaders) + components/** (Operations)
```

`app/preview/**` becomes a caller, never a source. Enforce with an ESLint `no-restricted-imports` rule forbidding `@/app/preview/*` outside `app/preview/**` — add to `web/eslint.config.mjs` in the first implementation ticket so the boundary is mechanical rather than remembered.

### 4.2 Proposed shared components

New directory `web/src/components/shell/`:

| Component | Props (no data types) | Extracted from | Replaces |
| --- | --- | --- | --- |
| `AppFrame` | `{ rail, sidebar, sidebarOpen, topBar, context, contextOpen, children }` | `page.tsx:260-266`, `preview.module.css:90-110` | `experience-shell.tsx:238-243`, `.experience-shell` |
| `Rail` / `RailItem` | `{ items: RailItem[], activeAreaId, footer }` | `page.tsx:303-371`, `687-710` | `experience-shell.tsx:264-310`, `nav-links.tsx` |
| `MobileHeader` | `{ brandHref, onOpenMenu, actions }` | `page.tsx:270-301` | `experience-shell.tsx:247-261` |
| `MobileBottomBar` | `{ items, activeAreaId }` | `page.tsx:337-347` | *new* |
| `MobileDrawer` | `{ onClose, children }` | `page.tsx` + `experience-shell.tsx:442-456` | keep the real one (already uses `useDialog`) |
| `WorkspaceSwitcher` | `{ workspaces, activeId, onSelect }` | `page.tsx:873-880` | `experience-shell.tsx:146-160` |
| `NavTree` / `TreeSection` / `TreeItem` | `{ sections: NavSection[], activeId }` | `page.tsx:778-828` | `experience-shell.tsx:201-217` **and** `notes-workspace.tsx:212-230` |
| `CommandTrigger` | `{ onOpen, shortcutLabel }` | `page.tsx:882-888` | `experience-shell.tsx:333-351` |
| `CommandPalette` | `{ groups, onSelect, onSubmitQuery, onClose }` | `states.tsx:538-620` | `experience-shell.tsx:360-410` |
| `TopBar` / `Breadcrumb` | `{ crumbs, status, actions, onToggleSidebar, onToggleContext }` | `page.tsx:406-447` | `experience-shell.tsx:318-354` |
| `ContextPanel` | `{ tabs, activeTab, onChangeTab, onClose, children }` | `context-panel.tsx:30-93` | `notes-workspace.tsx:881-1040` (`.note-inspector`) |
| `AssistantLauncher` | `{ onOpen }` | `page.tsx:549-557` | duplicate dock mounts at `experience-shell.tsx:220`, `:262` |
| `TabList` | existing generic | `tab-list.tsx:7-59` | `planner-workspace.tsx:420-433`, `settings-tabs.tsx`, `review-tabs.tsx` |
| `EmptyState` | `{ icon, title, body, action }` | `empty-state.tsx:8-44` | `.empty-state`, `.inline-empty` |
| `SidebarQuickAction` | `{ icon, label, href \| onClick }` | `page.tsx:890-894` | `experience-shell.tsx:181-199` |

Already shared and staying shared: `PanelResizer` (`components/panel-resizer.tsx`), `useDialog` (`lib/use-dialog.ts`).

### 4.3 Proposed typed view-model boundaries

Extend `web/src/lib/experience-navigation.ts` (it is already the right shape and already unit-tested) rather than inventing a parallel model:

```ts
// lib/shell/view-model.ts
type ShellIdentity   = { id: string; initial: string; title: string; subtitle: string };
type NavItem         = { id: string; label: string; href: string; icon?: IconName;
                         match?: 'exact' | 'prefix'; badge?: number; children?: NavItem[] };
type NavSection      = { id: string; title: string; addLabel?: string; items: NavItem[] };
type RailItem        = { areaId: ExperienceArea; href: string; label: string; badge?: number };
type Crumb           = { label: string; href?: string };
type ShellStatus     = { tone: 'saved' | 'saving' | 'error' | 'offline'; label: string };
type ContextTab      = { id: string; label: string; icon?: IconName };
type CommandGroup    = { id: string; title: string;
                         commands: Array<{ id: string; label: string; detail: string; href: string }> };

type ShellViewModel = {
  identity: ShellIdentity; rail: RailItem[]; sections: NavSection[];
  quickAction?: { label: string; icon: IconName; href: string };
  crumbs: Crumb[]; status: ShellStatus;
  contextTabs: ContextTab[]; commandGroups: CommandGroup[];
};
```

Per-family view models, each satisfiable by a fixture builder and by an authenticated loader:

- `WorkspaceViewModel` — `{ tree: NavSection[]; document: DocumentViewModel | null }` where `DocumentViewModel` is the presentation-safe projection of `NoteView` (`app/notes/actions.ts:9-18`) plus the `NoteKnowledgeContext` (`:20-51`) reduced to `{ properties, links, backlinks, outline, revisions, attachments }`. Cover and icon are **presentation metadata and must stay out of `body_markdown`** (roadmap stage 2); that means they are new columns or a new table — flag, do not assume.
- `PlannerViewModel` — `{ horizons: TabItem[]; summary: SummaryStat[]; groups: PlanGroup[]; direction: DirectionAnchor }`, satisfied by `getGoalsHierarchy` / `getActionTemplates` (`app/planner/page.tsx:5-8`) and by `preview-data.ts:307,313`.

Only authenticated routes may mutate. Every mutation stays behind `executeOperation` (`app/notes/actions.ts:6`). Shared components receive callbacks; they never import a Server Action.

---

## 5. Migration order that keeps authenticated routes working

The `PLANNER_UI_V2` flag (`lib/experience-rollout.ts:27-39`) is the safety mechanism: every step below lands behind `PLANNER_UI_V2 !== 'enabled'` staying on the legacy shell, and the e2e corpus (`playwright.config.ts:66`) validating the new one. Nothing here deletes a shell until the last step.

**Step 0 — capture baselines (before any code change).**
Add `web/tests/e2e/visual-shell.spec.ts` capturing `/preview` at desktop and mobile with `PLANNER_UI_PREVIEW=enabled`. Files: new spec; `web/playwright.config.ts` (add `snapshotDir`/`toHaveScreenshot` thresholds). No product code.

**Step 1 — unify tokens.**
Merge `--v2-*` into the global `:root` scale, keeping Preview's values where they diverge (Preview is the accepted reference), and add the missing ink/surface/interaction/accent tiers. Add the Inter / Source Serif 4 / mono stacks. Keep `--on-brand` / `--on-coral`, which Preview lacks and dark mode depends on. Delete the alias block.
Files: `web/src/app/globals.css:1-131` (+`:52-60` removal), `web/src/app/preview/preview.module.css:1-260` (replace definitions with `var()` aliases so Preview keeps rendering unchanged), `web/src/app/layout.tsx` (font loading only).
Keeps working because: every existing rule reads `var(--token)`; only values change. Verify with the Step 0 baselines and the axe suite.

**Step 2 — extract frame primitives, no consumer changes.**
Create `components/shell/**` and `lib/shell/view-model.ts` from the §4 list. Repoint `app/preview/page.tsx` at them so Preview is the first consumer and any regression shows up against the Step 0 baseline immediately.
Files: new `web/src/components/shell/*`, new `web/src/lib/shell/view-model.ts`, `web/src/app/preview/page.tsx:260-561,687-1136`, `web/src/app/preview/preview.module.css`, `web/eslint.config.mjs` (import boundary).
Authenticated routes untouched.

**Step 3 — rebuild `ExperienceShell` on the extracted frame.**
Replace `experience-shell.tsx:238-456` with `AppFrame` + `Rail` + `NavTree` + `TopBar` + `CommandPalette`. Move `primaryItems` (`:75-96`) and `commands` (`:97-112`) into `experience-navigation.ts` so there is one navigation source. Add the context column (empty for now) and the mobile bottom bar. Replace `Cloud workspace` (`:352`) with a `ShellStatus`. Collapse the two `AssistantDock` mounts to one `AssistantLauncher` + context slot.
Files: `web/src/components/experience-shell.tsx`, `web/src/lib/experience-navigation.ts`, `web/src/app/globals.css:174-558`, `web/src/tests/unit/experience-navigation.test.ts`.
Keeps working because: routes and hrefs are unchanged; only the frame is swapped, and only for V2 users.

**Step 4 — Workspace into the frame.**
Delete the `.notes-shell` grid (`globals.css:1962-1967`) and lift the Notes tree into the shell sidebar via `NavTree`; move `.note-inspector` (`notes-workspace.tsx:881-1040`) into the shared `ContextPanel`. Keep every real behaviour — autosave, indent/outdent, reorder, AI exclusion, attachments, backlinks, import dialog.
Files: `web/src/components/notes-workspace.tsx`, `web/src/components/notes-shell.tsx`, `web/src/app/notes/page.tsx` (must supply the tree to the shell), `web/src/lib/experience-navigation.ts`, `web/src/app/globals.css:1962-2260`, `web/src/components/experience-shell.tsx` (sidebar slot accepts route-supplied sections).
This is the step that removes the double sidebar, and the step with the highest regression risk (§6.2).

**Step 5 — Planner into the frame.**
Group the planner sidebar as Plan / Align; move horizon tabs to shared `TabList`; restyle `.plan-tree` / `.planner-overview` on the unified tokens; add the progress ring driven by real `getGoalsHierarchy` data.
Files: `web/src/components/planner-workspace.tsx`, `web/src/components/today-workspace.tsx`, `web/src/components/planner-calendar.tsx`, `web/src/components/weekly-review.tsx`, `web/src/components/vision-ui.tsx`, `web/src/lib/experience-navigation.ts`, `web/src/app/globals.css:945-1280`.

**Step 6 — perimeter, onboarding, import, settings.**
Reconcile `perimeter-shell.tsx` against `preview/perimeter.tsx:73-95`; apply the frame to `onboarding-wizard.tsx`, `note-import-dialog.tsx`, and the seven `app/settings/*` routes via shared `TabList`.
Files: `web/src/components/perimeter-shell.tsx`, `web/src/components/onboarding-wizard.tsx`, `web/src/components/settings-tabs.tsx`, `web/src/components/review-tabs.tsx`, `web/src/app/globals.css:6100-6231`.

**Step 7 — retire the old shell.**
Only once every real route renders the new frame: delete the legacy branch (`layout.tsx:62-79`), `nav-links.tsx`, `.app-shell` / `.app-sidebar` / `.nav-*` (`globals.css:560-682`), and `lib/experience-rollout.ts` with its test. Then mark the corresponding Preview screens superseded per roadmap step 6.
Files: `web/src/app/layout.tsx`, `web/src/components/nav-links.tsx` (delete), `web/src/lib/experience-rollout.ts` (delete), `web/tests/unit/experience-rollout.test.ts` (delete), `web/src/app/globals.css`, `web/playwright.config.ts` (drop `PLANNER_UI_V2`).

---

## 6. Collision points and regression risks

**6.1 Preview sizes its grid with a style attribute; the CSP discards it in a production build.**
`app/preview/page.tsx:233-236` builds `frameStyle` and applies it at `:243` and `:264`. `status.md` records that a nonce does not extend to `style` attributes, so these are parsed and discarded in a real build — the sidebar and context widths silently fall back to the `248px`/`336px` defaults in `preview.module.css:94-97`, and `PanelResizer` (`page.tsx:389-398`, `:537-546`) does nothing visible. The real shell already solved this via CSSOM (`experience-shell.tsx:120-122`). **Any width, progress ring, or bar extracted from Preview must be written through `style.setProperty` or a bounded class, never a style attribute.** This defect is invisible in `next dev`, so it will not show up until the production-build e2e run.

**6.2 The Notes double sidebar (Step 4) is the highest-risk change.**
`.notes-shell` (`globals.css:1962`) assumes it owns the viewport (`calc(100vh - 96px)`, hardcoded for the *legacy* topbar) and renders its own tree and inspector. Collapsing it into the shell means the Notes tree must be supplied by `app/notes/page.tsx` to a client shell that currently receives none, and the deliberate remount-per-note contract documented at `notes-shell.tsx:9-22` must survive — that comment records a real defect where an import report was destroyed by a remount. Regressions to watch: the import dialog surviving `router.refresh()`; the genuinely nested `<ul>` structure (`notes-workspace.tsx:212`) that `status.md` records as fixing a screen-reader defect; indentation at narrow widths, which a previous layout override flattened.

**6.3 Horizon tab semantics differ between the two surfaces.**
Preview's tabs are time horizons: `['Today','Week','Month','Quarter','Year','Vision']` (`page.tsx:1283`). The real filter is `'all' | GoalType` (`planner-workspace.tsx:47`, `:420-433`), where `GoalType` is a goal *level*, not a time window, and "Today" lives at `/` while "Vision" is a separate route (`experience-navigation.ts:50-58`). Adopting Preview's strip verbatim would either change what the filter means or create tabs that navigate rather than filter. Needs a product decision.

**6.4 Two theme stores will fight during Step 1–2.**
`planner-theme` on `<html>` (`theme-toggle.tsx:7`, `layout.tsx:48`) vs `planner-preview-theme` on `.previewRoot` (`page.tsx:99`, `:242`). Once tokens are global (Step 1), a `.previewRoot[data-theme='dark']` (`preview.module.css:178`) nested inside a light `<html>` produces a half-themed page. Preview must adopt `ThemeToggle` and the `<html>` stamp in the same commit as the token merge, not after.

**6.5 The legacy shell is the production default and has no browser coverage.**
`experience-rollout.ts:38` returns `false` for absent configuration, and `status.md` notes Vercel production environment values are not fully re-verified. If `PLANNER_UI_V2` is unset in production, all of this work ships invisible. Confirm the production value before Step 3, and keep the legacy branch until Step 7.

**6.6 Rail slicing is positional.**
`experience-shell.tsx:269` and `:287` slice `primaryItems` at index 4. Adding an area — which Step 3 makes tempting — moves Settings and Notifications out of the rail footer with no type error and no test failure. `experience-navigation.ts` has no rail concept, so nothing catches it. Make `RailItem` carry an explicit `placement: 'main' | 'footer'`.

**6.7 Breakpoint reconciliation will move layouts on real routes.**
Real `980/900/760` vs Preview `1180/900/820/600`. Adopting Preview's set changes when Planner Calendar (`globals.css:5341-5397`) and Workspace Search (`:5355-5367`) reflow, on routes this ticket is not otherwise touching. `status.md` records that reflow at 320 CSS px is a verified gate — `reflow-and-motion.spec.ts` must be re-run at every step, not just at the end.

**6.8 Preview's JS media queries are a hydration surface.**
`page.tsx:2612-2645` uses `useSyncExternalStore` with server snapshots that deliberately guess (`() => true` for compact/narrow at `:161`, `:163`; `() => false` for the mobile bar at `:164`). The real shell is CSS-only and has no such guess. Porting the mobile bottom bar (`page.tsx:337-347`) imports this pattern into an authenticated server-rendered route; prefer a CSS-driven bar so there is no first-paint mismatch.

**6.9 Font introduction is a layout-wide change.**
`globals.css:156` is `Arial, Helvetica, sans-serif`. Switching to the Inter stack changes metrics on every screen at once. Combined with `globals.css:6223-6224`, which records that ~42 places still carry a hardcoded `13px` outside the six-step scale, Step 1's visual diff will be large and will span far more than the shell. Land the font in its own commit with baselines regenerated, so a genuine layout regression is not buried in a metrics shift.

**6.10 Shared-file single-writer rule.**
`globals.css`, `layout.tsx`, and `experience-shell.tsx` are touched by Steps 1, 3, 4, 5, 6, and 7. Per `.agents/README.md:33`, these have one writer at a time. Steps 4 and 5 both edit `experience-navigation.ts` and `globals.css`; they must be sequential tickets, not parallel workers.

---

## 7. Focused tests and visual baselines for the first implementation

### 7.1 Visual baselines — capture before any code change

None exist today: grepping `web/` for `toHaveScreenshot`, `snapshotDir`, and `screenshot(` returns no matches, and `playwright.config.ts:37` sets `screenshot: 'only-on-failure'` only. The two existing projects (`chromium` / `mobile-chromium` Pixel 7, `playwright.config.ts:40-43`) give the desktop and mobile widths for free.

New `web/tests/e2e/visual-shell.spec.ts`, run with `PLANNER_UI_PREVIEW=enabled` (already set at `playwright.config.ts:66`), full-page, `animations: 'disabled'`:

| Baseline | Preview surface | Real counterpart to compare in Step 3–5 |
| --- | --- | --- |
| `preview-workspace-document` | `page.tsx:1137` | `/notes` |
| `preview-workspace-tree` | `page.tsx:882-963` | `/notes` sidebar |
| `preview-planner-plan` | `page.tsx:1254` | `/planner` |
| `preview-planner-sidebar` | `page.tsx:965-1022` | `/planner` sidebar |
| `preview-home` | `page.tsx:2022` | `/` |
| `preview-command-palette` | `states.tsx:538` | V2 palette |
| `preview-context-panel` | `context-panel.tsx:30` | `.note-inspector` |
| `preview-perimeter-signin` | `perimeter.tsx:112` | `/login` |

Each at desktop and Pixel 7, and each in light and dark (`.previewRoot[data-theme]`, `preview.module.css:178`). `status.md` records that the dark-mode axe scan previously measured colours mid-transition; wait for transitions to settle before capturing, the same way that fix does.

### 7.2 Unit tests (Vitest — 45 files / 537 tests today)

- **Extend** `web/tests/unit/experience-navigation.test.ts`: rail placement (`main` vs `footer`, guarding §6.6), section grouping for Plan/Align, badge propagation, `exact` vs `prefix` matching for `/planner` vs `/planner/calendar`, and both `canonical` values.
- **New** `web/tests/unit/shell-view-model.test.ts`: assert a fixture builder and a loader projection both satisfy `ShellViewModel` / `WorkspaceViewModel` / `PlannerViewModel`; assert the fixture builder is importable only from `app/preview/**`.
- **New** `web/tests/unit/design-tokens.test.ts`: parse `globals.css` and assert (a) every `--v2-*` name resolves to a global token or is gone, (b) `[data-theme='dark']` defines every name `:root` defines, (c) the `prefers-color-scheme` block matches the `[data-theme='dark']` block key-for-key — the duplication at `globals.css:63-131` is copy-paste today and will drift.
- **New** `web/tests/unit/style-attribute-audit.test.ts`: assert no `style={` with a dynamic value in `components/shell/**` or `app/preview/**`. This is the mechanical guard for §6.1, which is otherwise only visible in a production build.
- **Keep** `web/tests/unit/experience-rollout.test.ts` until Step 7.
- **Re-run** `web/tests/unit/form-labelling.test.ts` and `state-pages.test.ts` after Step 2 — both assert on markup the extraction moves.

### 7.3 Browser tests (Playwright, production build)

Focused set for the first implementation (Steps 1–3):

- **New** `web/tests/e2e/shell-frame.spec.ts` — desktop: rail exposes six areas with `aria-current` on the active one; sidebar collapse/expand persists across navigation; `⌘K` opens the palette, `Escape` closes it and returns focus to the trigger (the `useDialog` contract, `experience-shell.tsx:415-417`); resizer moves the sidebar **and the width actually applies in a production build** (asserting computed width, which is the only assertion that would have caught §6.1). Mobile: header menu opens the drawer, drawer traps focus, bottom bar shows the top areas at ≤600px.
- **Extend** `web/tests/e2e/authenticated-accessibility.spec.ts` — add the context panel and the mobile bottom bar; run light and dark.
- **Re-run every step**: `reflow-and-motion.spec.ts` (320 CSS px + reduced motion — `status.md` confirms both gates fail without their fix, so they are not vacuous), `keyboard-navigation.spec.ts`, `accessibility.spec.ts`.
- **Re-run at Step 4**: `journey-notes.spec.ts` (the vault round-trip and restore, and the import-report-survives-refresh case from `notes-shell.tsx:9-22`).
- **Re-run at Step 5**: `journey-planner.spec.ts`, `journey-planner-calendar.spec.ts`, `journey-today.spec.ts`, `journey-capture.spec.ts`.
- **Re-run at Step 6**: `journey-onboarding-center.spec.ts`, `auth-boundary.spec.ts`.
- **Unchanged but must stay green**: `security-headers.spec.ts` — the token and font work must not widen the CSP. `status.md` is explicit that `style-src-attr` is not portable and `'unsafe-inline'` is ignored once a nonce is present.

Gate command per `AGENTS.md`: `cd web && npm run agent:check`, plus the affected browser specs.

### 7.4 Blocker to resolve before Step 3

The Preview and real navigation models describe different destination sets (§3.3): Preview has "This week", "Action inbox", and Plan/Align grouping that `experience-navigation.ts` lacks; `experience-navigation.ts` has Conversations, Activity, and Trash that Preview's workspace tree lacks. Extraction cannot proceed without one agreed list, and that is a product decision for the Codex lead, not an implementation detail. Everything in Steps 0, 1, and 2 is unblocked and can proceed in parallel with that decision.

---

## Acceptance check

| Criterion | Where met |
| --- | --- |
| Workspace and Planner both covered | §2.2 and §2.3 element-by-element; §5 Steps 4 and 5; §6.2 and §6.3 |
| Fixture data clearly separated from authenticated loaders and Operations | §2.4 enumerates every fixture site by file:line; §4.1 states the one-way import rule with an ESLint guard; §4.3 requires mutation to stay behind `executeOperation` |
| One shared frame without making Preview a production dependency | §1.3 records the existing one-way boundary and the `PLANNER_UI_PREVIEW` 404 gate; §4.1/§4.2 put shared code in `components/shell/**` with `app/preview/**` as a caller; §5 Step 2 makes Preview the first consumer, not the source |
| Every proposed first-step code change names its affected files | §5 Steps 0–7 each list affected files; §7 names each new and extended test file |

## Handoff

- **Behavior changed:** none. Read-only audit.
- **Files changed:** `.agents/reports/BR-01-claude-audit.md` (new) only.
- **Checks run:** no build, lint, or test run — this ticket changes no product code and `npm run agent:check` would report only the pre-existing state recorded in `docs/status.md`.
- **Known risks/blockers:** the navigation-model reconciliation in §7.4 blocks Step 3 and needs a Codex lead decision. §6.1 (style attributes discarded under CSP) and §6.5 (`PLANNER_UI_V2` unset in production) are the two findings most likely to make otherwise-correct work ship invisibly.
- **Outside writable paths, for the lead's awareness:** no `web/**` change was made or is proposed by this ticket; every change named in §5 belongs to the follow-on implementation ticket.
