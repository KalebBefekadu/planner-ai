# Preview Pattern Inventory

Status: **migration checklist.** Owning ticket: [UI-01 / #116](https://github.com/KalebBefekadu/planner-ai/issues/116).
Retirement is [UI-03 / #140](https://github.com/KalebBefekadu/planner-ai/issues/140); `/preview` may not be deleted while any row below is still `open`.

`/preview` is a fixture-backed visual reference, not a second product. This file records what it contains, where each pattern belongs in the real application, and what has actually been demonstrated. It exists so that deleting the route cannot quietly delete design work.

Baseline: `integration/dogfood` at `097ce79`.

## How to read a row

**Disposition** is a decision about the pattern, not a status:

| Disposition | Meaning |
| --- | --- |
| **keep** | Already implemented in the real app. The Preview copy is redundant. |
| **extract** | Implemented in the real app, but Preview still holds a visual detail worth porting. |
| **adapt** | Not implemented. Belongs in the personal MVP under a named ticket. |
| **defer** | Not implemented and deliberately out of MVP scope. Must be preserved in a FUT ticket before removal. |

**Verification** is the honest state of the evidence, and the three levels are not interchangeable:

| Verification | Meaning |
| --- | --- |
| **behavior** | Works against real data and Operations, with automated coverage naming it. |
| **visual** | The real screen exists and resembles the reference. Resemblance only; no behavioral claim. |
| **open** | Not implemented, or implemented without evidence. |

A screenshot never advances a row past `visual`. A row is only `behavior` when a named test exercises it.

## Isolation

Two properties keep Preview from becoming a second design system. Both are currently true and both are enforced by `web/tests/unit/preview-isolation.test.ts`, so a regression fails the build rather than being discovered at deletion time.

1. **No production module imports a Preview module.** Nothing outside `src/app/preview/` imports `preview-data`, `preview.module.css`, or any file under that directory.
2. **Preview consumes the shared design tokens rather than redefining them.** `preview.module.css` reads 983 `var(--…)` references from `globals.css` and declares no competing token palette. Preview also imports two production modules (`@/components/panel-resizer`, `@/lib/use-dialog`), which is the intended direction of reuse.

## Shell and chrome

| Pattern | Disposition | Real destination | Owning ticket | Verification |
| --- | --- | --- | --- | --- |
| Global rail, primary navigation | keep | `experience-shell.tsx` | UI-02 / [#131](https://github.com/KalebBefekadu/planner-ai/issues/131) | behavior — `keyboard-navigation.spec.ts`, `authenticated-accessibility.spec.ts` |
| Mobile menu open/close, mobile bar | keep | `experience-shell.tsx` | UI-02 / [#131](https://github.com/KalebBefekadu/planner-ai/issues/131) | behavior — `keyboard-navigation.spec.ts` ("the mobile workspace menu is keyboard-operable") |
| Command palette (search commands and workspace) | keep | `experience-shell.tsx` | UI-02 / [#131](https://github.com/KalebBefekadu/planner-ai/issues/131) | visual — the palette exists and opens; no test names its command results |
| Sidebar tree with resizer | keep | `notes-shell.tsx`, `panel-resizer.tsx` | WS-02 / [#123](https://github.com/KalebBefekadu/planner-ai/issues/123) | behavior — `journey-notes.spec.ts` |
| Context panel: AI / Properties / Links tabs | extract | `notes-workspace.tsx` note inspector | WS-03 / [#124](https://github.com/KalebBefekadu/planner-ai/issues/124) | visual — the real inspector carries details, connections and history; the three-tab framing and its auto-open rule are not ported |
| Context panel auto-open rule (open only where it helps, closed on compact) | extract | `experience-shell.tsx` / inspector | WS-03 / [#124](https://github.com/KalebBefekadu/planner-ai/issues/124) | open |
| Theme control (system / light / dark) | keep | `theme-toggle.tsx` | UI-02 / [#131](https://github.com/KalebBefekadu/planner-ai/issues/131) | visual |
| Top-bar account menu, notifications entry | keep | `experience-shell.tsx`, `/notifications` | UI-02 / [#131](https://github.com/KalebBefekadu/planner-ai/issues/131) | visual |
| Quick capture from the shell | adapt | shell entry into Capture | WS-04 / [#125](https://github.com/KalebBefekadu/planner-ai/issues/125) | open — Capture lives at `/planner/inbox`; the shell has no capture control |
| Voice capture control | adapt | Capture surface | WS-04 / [#125](https://github.com/KalebBefekadu/planner-ai/issues/125) | open — transcription exists; the Preview control placement does not |

## Workspace: document

| Pattern | Disposition | Real destination | Owning ticket | Verification |
| --- | --- | --- | --- | --- |
| Markdown document editing, autosave | keep | `notes-workspace.tsx`, `rich-markdown-editor.tsx` | WS-01 / [#122](https://github.com/KalebBefekadu/planner-ai/issues/122) | behavior — `journey-notes.spec.ts`, `markdown-rich-editor.test.ts` |
| Formatting controls (bold, italic, heading, list, task list, table) | keep | `notes-workspace.tsx` | WS-01 / [#122](https://github.com/KalebBefekadu/planner-ai/issues/122) | behavior — `markdown-editing.test.ts` |
| Note outline / document navigation | keep | `notes-workspace.tsx` ("Note outline") | WS-02 / [#123](https://github.com/KalebBefekadu/planner-ai/issues/123) | visual |
| Backlinks and note-to-note links | keep | `notes-workspace.tsx` | WS-02 / [#123](https://github.com/KalebBefekadu/planner-ai/issues/123) | behavior — `journey-notes.spec.ts` |
| Attachments | keep | `notes-workspace.tsx` ("Attach a file") | WS-05 / [#129](https://github.com/KalebBefekadu/planner-ai/issues/129) | visual — upload exists; availability and recovery states are the open part |
| Page cover image and reposition | adapt | Note appearance | WS-03 / [#124](https://github.com/KalebBefekadu/planner-ai/issues/124) | open — no real implementation |
| Page icon picker | adapt | Note appearance | WS-03 / [#124](https://github.com/KalebBefekadu/planner-ai/issues/124) | open — no real implementation |
| Favorite a page | adapt | Notes organization | WS-02 / [#123](https://github.com/KalebBefekadu/planner-ai/issues/123) | open — no real implementation |
| Block hover menu (move, duplicate, delete), insert-below control | adapt | Editor block controls | WS-03 / [#124](https://github.com/KalebBefekadu/planner-ai/issues/124) | open — the real editor has no per-block menu |
| Page mention (`@`) | adapt | Editor linking | WS-02 / [#123](https://github.com/KalebBefekadu/planner-ai/issues/123) | open — linking exists through the inspector, not inline |
| Reorder / reparent controls | keep | `notes-workspace.tsx` (move up/down/out, make child) | WS-02 / [#123](https://github.com/KalebBefekadu/planner-ai/issues/123) | behavior — `note-sibling-order.test.ts` |

## Workspace: other modes

| Pattern | Disposition | Real destination | Owning ticket | Verification |
| --- | --- | --- | --- | --- |
| Table view, "Add view", "Workspace views" switcher | defer | none | FUT-01 / [#141](https://github.com/KalebBefekadu/planner-ai/issues/141) | open — structured databases and views are post-MVP |
| Knowledge graph view | defer | none | FUT-02 / [#142](https://github.com/KalebBefekadu/planner-ai/issues/142) | open |
| Canvas view, "Add canvas item" | defer | none | FUT-02 / [#142](https://github.com/KalebBefekadu/planner-ai/issues/142) | open |
| Share dialog | defer | none | FUT-04 / [#144](https://github.com/KalebBefekadu/planner-ai/issues/144) | open — a first-release Workspace has exactly one owner |

The four rows above are the reason UI-03 cannot simply delete `/preview`. Each FUT ticket must carry the reference asset before the route is removed.

## Planner

| Pattern | Disposition | Real destination | Owning ticket | Verification |
| --- | --- | --- | --- | --- |
| Plan surface, Goal hierarchy | keep | `planner-workspace.tsx`, `/planner` | PL-07 / [#119](https://github.com/KalebBefekadu/planner-ai/issues/119) | behavior — `journey-planner.spec.ts` |
| Planning-horizon switcher | keep | `planner-workspace.tsx` ("Filter plan by horizon") | PL-07 / [#119](https://github.com/KalebBefekadu/planner-ai/issues/119) | visual — the control exists; correct real periods are PL-07's open question |
| Today: focus list, completion, outcome menu | keep | `today-workspace.tsx`, `/planner/today` | PL-06 / [#118](https://github.com/KalebBefekadu/planner-ai/issues/118) | behavior — `journey-today.spec.ts` |
| Today: action composer ("Action title", add action) | keep | `today-workspace.tsx` | PL-05 / [#117](https://github.com/KalebBefekadu/planner-ai/issues/117) | behavior — `journey-today.spec.ts`, four cases added by PL-05 |
| Week calendar, previous/next week, day picker | keep | `planner-calendar.tsx`, `/planner/calendar` | PL-08 / [#120](https://github.com/KalebBefekadu/planner-ai/issues/120) | behavior — `journey-planner-calendar.spec.ts` |
| Planner inbox | keep | `/planner/inbox`, `capture-proposal-queue.tsx` | WS-04 / [#125](https://github.com/KalebBefekadu/planner-ai/issues/125) | behavior — `journey-capture.spec.ts` |
| Review surface | keep | `/review`, `weekly-review.tsx`, `period-review.tsx` | PL-09 / [#121](https://github.com/KalebBefekadu/planner-ai/issues/121) | visual — the surface exists; the full week-close journey is PL-09's open question |
| Goals and horizons | keep | `/goals`, `align-surfaces` equivalent | PL-07 / [#119](https://github.com/KalebBefekadu/planner-ai/issues/119) | visual |
| Vision | keep | `/vision`, `vision-ui.tsx` | PL-07 / [#119](https://github.com/KalebBefekadu/planner-ai/issues/119) | visual |
| AI operation proposal card | keep | `review-ai-proposal.tsx`, `capture-proposal-queue.tsx` | AI-01 / [#133](https://github.com/KalebBefekadu/planner-ai/issues/133) | behavior — `proposal-anatomy.test.ts`, `journey-assistant.spec.ts` |

## Secondary screens

| Pattern | Disposition | Real destination | Owning ticket | Verification |
| --- | --- | --- | --- | --- |
| Home view | keep | `/` (Today is the real home) | UI-02 / [#131](https://github.com/KalebBefekadu/planner-ai/issues/131) | behavior — `journey-today.spec.ts`. Preview's Home is a separate dashboard; the real product deliberately makes Today the entrance. Recorded as an accepted divergence, not a gap. |
| Search view, "Narrow results" | keep | `/search` | WS-02 / [#123](https://github.com/KalebBefekadu/planner-ai/issues/123) | behavior — `workspace-search.test.ts` |
| Notifications, "Filter notifications" | keep | `/notifications`, `notifications-center.tsx` | UI-02 / [#131](https://github.com/KalebBefekadu/planner-ai/issues/131) | visual |
| Settings: preferences, ai, memory, data, security | keep | `/settings/*`, `settings-tabs.tsx` | UI-02 / [#131](https://github.com/KalebBefekadu/planner-ai/issues/131) | visual |
| Settings: integrations | keep | `/settings/mcp`, `mcp-token-manager.tsx` | MCP-01 / [#135](https://github.com/KalebBefekadu/planner-ai/issues/135) | behavior — `mcp-token-lifecycle.spec.ts` |
| Settings: account | extract | no dedicated route; account controls are split across security and data | UI-02 / [#131](https://github.com/KalebBefekadu/planner-ai/issues/131) | open — decide whether the section is created or the divergence is accepted |
| "Related settings" cross-links | extract | `settings-tabs.tsx` | UI-02 / [#131](https://github.com/KalebBefekadu/planner-ai/issues/131) | open |

## Perimeter and onboarding

| Pattern | Disposition | Real destination | Owning ticket | Verification |
| --- | --- | --- | --- | --- |
| Sign in, sign up, reset password, provider buttons | keep | `/login`, `/signup`, `/forgot-password`, `perimeter-shell.tsx` | ON-01 / [#132](https://github.com/KalebBefekadu/planner-ai/issues/132) | behavior — `auth-boundary.spec.ts` |
| Marketing aside (the three promises) | keep | `perimeter-shell.tsx` | ON-01 / [#132](https://github.com/KalebBefekadu/planner-ai/issues/132) | visual |
| Onboarding flow | keep | `/onboarding`, `onboarding-wizard.tsx`, `onboarding-center.tsx` | ON-01 / [#132](https://github.com/KalebBefekadu/planner-ai/issues/132) | behavior — `journey-onboarding-center.spec.ts` |

## System states

Preview carries ten full-surface states. These are the rows most likely to be lost silently, because a real app only shows them under conditions a screenshot pass never reaches.

| Pattern | Disposition | Real destination | Owning ticket | Verification |
| --- | --- | --- | --- | --- |
| Offline / waiting to sync | keep | `service-worker-registration.tsx`, `async-status.tsx` | UI-02 / [#131](https://github.com/KalebBefekadu/planner-ai/issues/131) | behavior — `offline-capture.spec.ts` |
| Conflict ("this page changed in two places") | extract | `notes-workspace.tsx` conflict handling | WS-01 / [#122](https://github.com/KalebBefekadu/planner-ai/issues/122) | open — optimistic concurrency raises a version conflict, but the Preview side-by-side recovery surface is not built |
| AI unavailable | keep | `assistant-dock.tsx` | AI-02 / [#134](https://github.com/KalebBefekadu/planner-ai/issues/134) | visual |
| AI budget exhausted | keep | `ai-usage-dashboard.tsx`, `/settings/ai` | AI-02 / [#134](https://github.com/KalebBefekadu/planner-ai/issues/134) | visual |
| AI error | keep | `assistant-dock.tsx` | AI-02 / [#134](https://github.com/KalebBefekadu/planner-ai/issues/134) | visual |
| Permission denied | keep | operation failure messaging (`stableFailure`) | UI-02 / [#131](https://github.com/KalebBefekadu/planner-ai/issues/131) | behavior — `operations.test.ts`; no full-surface screen |
| Generic error | keep | `src/app/error.tsx` | UI-02 / [#131](https://github.com/KalebBefekadu/planner-ai/issues/131) | behavior — `state-pages.test.ts` |
| Not found | keep | `src/app/not-found.tsx` | UI-02 / [#131](https://github.com/KalebBefekadu/planner-ai/issues/131) | behavior — `state-pages.test.ts` |
| Trash | keep | `/trash`, `trash-manager.tsx` | IM-04 / [#130](https://github.com/KalebBefekadu/planner-ai/issues/130) | visual |
| Version history | keep | `notes-workspace.tsx` history | WS-01 / [#122](https://github.com/KalebBefekadu/planner-ai/issues/122) | visual |
| Empty state pattern | keep | `.inline-empty` across real routes | UI-02 / [#131](https://github.com/KalebBefekadu/planner-ai/issues/131) | visual |

## What UI-03 still needs before deletion

Every row above has a disposition and an owning ticket, which satisfies UI-01. Removal is gated on these, which are UI-03's job, not this file's:

1. The four `defer` rows are captured in FUT-01, FUT-02 and FUT-04 with their reference assets.
2. Every `adapt` row is either implemented under its ticket or explicitly accepted as a limitation by the owner.
3. Every `extract` row is ported or downgraded to an accepted divergence.
4. Desktop and mobile references are captured for empty, populated, error and dark states using fixture data only.

Nine `open` rows remain. They are the real content of WS-02, WS-03, WS-04 and UI-02, and none of them is blocked by this inventory.
