# PL-01: Planner convergence audit

Auditor: Claude, read-only. Base commit: `a3bc896`.
Scope: authenticated Planner daily loop versus the accepted Preview Planner experience. No product source read beyond what the recommendation touches; no source modified.

## Route Reality

The roadmap names `/planner`, `/today`, `/calendar`, and review. The routes that actually exist are:

| Roadmap name | Real route | Component | Data |
| --- | --- | --- | --- |
| Today | `/` (`src/app/page.tsx`) | `TodayWorkspace` | `getTodayData()`, canonical mode only; legacy branch renders a separate read-only Today |
| This week | `/planner` | `PlannerWorkspace` | `getGoalsHierarchy()`, `getActionTemplates()` |
| Calendar | `/planner/calendar` | `PlannerCalendar` | `getTodayData()`; `notFound()` outside canonical |
| Review | `/review` | `WeeklyReview` / `PeriodReview` | `getWeeklyReviewData()` / `getPeriodReviewData()`; `notFound()` outside canonical |

There is no `/today` route. `src/app/today/` holds only `actions.ts`. Nothing needs to change here — but the roadmap's route names should not be treated as paths.

The daily loop already has real data, real versioned Operations, authorization, Activity, undo, and failure states preserved through `actionFailureMessage`. The convergence gap is not the data layer.

## Preview Pattern Classification

| Accepted Preview pattern | Verdict | Where it stands |
| --- | --- | --- |
| Global rail, brand mark, avatar | **Reuse** — done | `ExperienceShell` renders it from `experienceRailItems` |
| Contextual sidebar with titled sections | **Reuse** — done for Planner | `experienceNavigationForPath` returns a Planner section set |
| Command palette (⌘K), focus trap | **Reuse** — done | Shares `useDialog` with `/preview` by design |
| Breadcrumb top bar, sync state | **Reuse** — done | `experience-topbar` |
| Mobile drawer + bottom nav | **Reuse** — done | Pinned by `keyboard-navigation.spec.ts` |
| Content-owned sidebar (Notes tree) | **Reuse** — done | `contentOwnsSidebar`, `/notes` only |
| Fixture Planner screens in `preview-data.ts` | **Discard on supersede** | Not on this slice's path |
| `src/components/nav-links.tsx` | **Discard** | Dead: `NavLinks` has no importer anywhere in `src` |

The frame has converged. What has **not** converged is which frame state the Planner routes get.

## The Material Gap

`experienceAreaForPath` (`web/src/lib/experience-navigation.ts:48`) resolves `/` to `home`, because `plannerPaths` is `['/planner', '/goals', '/vision', '/review']` and `/` matches nothing. But the Planner contextual sidebar's first entry is `{ label: 'Today', href: '/' }` (line 106).

Consequence for daily dogfooding, every single day:

1. From `/planner`, the sidebar shows the seven-item Planner set: Today, This week, Calendar, Action inbox, Weekly review, Goals & horizons, Vision.
2. Clicking **Today** — the first and most-used entry — navigates to `/`, which resolves to `home`.
3. The sidebar is replaced by the three-item Home set ("Focus and momentum": Today, Capture inbox, Weekly review). Calendar, This week, Goals & horizons, and Vision vanish.
4. The rail highlight moves off Planner onto Home.
5. `currentLabel` falls back to the `home` navigation title, so the breadcrumb reads *Home › Today* rather than *Planner › Today*.

So the one screen the owner opens first each morning is the one screen that drops them out of Planner navigation. Getting from Today to the Calendar takes a rail hop back to Planner first. This is precisely the roadmap's stage-3 requirement — "Planner-only contextual navigation for Today, This Week, Calendar, Action Inbox, Review, Goals and Horizons, and Vision" — failing at its first item.

The identical defect exists for **Action inbox**: the Planner sidebar links `/inbox`, but `/inbox` is in `workspacePaths`, so that entry also cannot be reached without leaving Planner, and can never render as active. Same function, same fix, so it belongs in the same slice.

Neither is caught today. `tests/unit/experience-navigation.test.ts` asserts `experienceAreaForPath` for `/planner`, `/planner/calendar`, `/goals`, `/vision`, `/review` — but never for `/` or `/inbox`, which are exactly the two entries that are wrong.

## Recommended Ticket: PL-02 — Today lands inside Planner

One behavior change: **the Planner contextual navigation survives navigating to Today and to the Action inbox.**

### Approach

Make `/` resolve to the `planner` area and fold the rail's Home entry into Planner, so Today becomes the Planner landing destination rather than a fourth top-level area. Sidebar entries and their href set do not change; only area resolution and the rail do.

For `/inbox`, resolve by origin rather than by path: keep `/inbox` in `workspacePaths` (Capture inbox is a genuine Workspace destination) and give the Planner sidebar's Action inbox entry a Planner-scoped href, `/inbox?from=planner`, with `experienceAreaForPath` reading that marker. This preserves both readings without duplicating the route. If the Codex lead prefers not to introduce a query marker, the conservative fallback is to drop **Action inbox** from the Planner sidebar for this slice and keep only the `/` fix — that alone closes the daily-use defect.

### Exact files

- `web/src/lib/experience-navigation.ts` — the whole behavior change. Add `/` to Planner area resolution; remove or repoint the `home` rail item; delete the now-unreachable `home` branch of `experienceNavigationForPath` and the `'home'` member of `ExperienceArea`.
- `web/src/components/experience-shell.tsx` — `areaIcons` is `satisfies Record<ExperienceArea, …>`, so dropping `'home'` requires removing the `home` key and the now-unused `Home` import. Nothing else in the shell changes.
- `web/tests/unit/experience-navigation.test.ts` — extend.

### Tests

- Unit, in `experience-navigation.test.ts`: `experienceAreaForPath('/')` is `'planner'`; every href in `experienceNavItems(experienceNavigationForPath('/planner', true))` resolves back to `'planner'` via `experienceAreaForPath` — a loop assertion, so this class of defect cannot be reintroduced by adding a sidebar entry; update the rail-placement assertion to the new main set.
- Browser, in `tests/e2e/journey-today.spec.ts`: from `/planner`, click **Today** in the sidebar and assert the `Planner navigation` landmark and the Calendar entry are still present, and the breadcrumb still reads Planner. Confirm this fails before the fix rather than passing vacuously — the roadmap's stated bar.
- Do not add a Playwright project or fixture; the existing `workspace` fixture covers it.

### Responsive risk

- **Mobile bottom nav** renders `mainItems`. Removing Home takes it from four entries to three; confirm the reduced set still fills the bar and does not shift touch targets under the 44px minimum at 320 CSS px.
- **Mobile drawer** renders `experience-mobile-primary` from the same list; `keyboard-navigation.spec.ts` asserts the `Planner navigation` label from `/planner/calendar` and stays green, but re-run it.
- **Reflow at 320px / 400% zoom** is an existing gate (`reflow-and-motion.spec.ts`) covering Today; a changed sidebar on `/` puts it back in scope.

### Collision-sensitive paths

`experience-navigation.ts` and `experience-shell.tsx` are the shared shell. Per `.agents/README.md`, the shell takes one writer at a time — `BR-02-brand-shell` (Codex) is active on the same frame. **PL-02 must not start until BR-02 merges into `integration/dogfood`.** Both files were also touched by the WS-02 Notes contextual-sidebar work in `a3bc896`, so rebase before implementing.

### Out of scope, deliberately

No data-contract change, no loader change, no Operation change, no `/preview` edit, no Graph, Canvas, database, collaboration, plugin, MCP, or AI work.

## Secondary Findings (recorded, not proposed)

Outside PL-01's writable paths; for the Codex lead to schedule.

1. `web/src/components/nav-links.tsx` is dead — `NavLinks` has no importer. It still encodes the old flat nav model and will misdirect the next reader of the shell. Delete when the shell has one writer.
2. `src/app/page.tsx` carries a full legacy non-canonical Today alongside the canonical `TodayWorkspace`. Status records the rollback window as still open, so this is correct for now, but it is the largest single block of duplicated Planner UI and should be removed at canonical cutover.
3. `/planner/calendar` and `/review` call `notFound()` outside canonical mode while the Planner sidebar hides those entries — consistent, but it means a bookmarked Calendar URL 404s rather than explaining itself. Low priority.

## Handoff

- **Behavior changed:** none. Read-only audit.
- **Files changed:** `.agents/reports/PL-01-planner-audit.md` (added). No product source, tests, migrations, lockfiles, CI, roadmap, or status touched.
- **Checks run:** none executed. `npm run agent:check` was not run because this task changes no code under `web/`; running it would prove nothing about a Markdown report. The findings are read-verified against `web/src/lib/experience-navigation.ts`, `web/src/components/experience-shell.tsx`, `web/src/app/page.tsx`, `web/src/app/planner/**`, `web/src/app/review/page.tsx`, and `web/tests/unit/experience-navigation.test.ts`.
- **Risks and blockers:** The `/` Planner-area defect is inferred from route and area-resolution code, not observed in a running browser; PL-02's first step should be the failing browser assertion, which confirms it directly. PL-02 collides with the active `BR-02-brand-shell` on the shared shell and is blocked until it merges. The TokenSave index is stale (last synced ~12h, and scoped to the primary checkout rather than this worktree), so it returned nothing for the Planner query and this audit used targeted reads instead; `tokensave init` in each worktree would restore graph-first research.
- **Commit SHA:** report written against `a3bc896`; uncommitted in this worktree — Codex to commit on `claude/pl-01-planner-audit`.
