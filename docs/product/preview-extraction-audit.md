# Preview Extraction Audit (UI-03)

Status: **audit.** No behaviour changed by this document.
Owning ticket: [UI-03 / #140](https://github.com/KalebBefekadu/planner-ai/issues/140).
Companion: [Preview inventory](preview-inventory.md), which UI-01 owns. This file re-verifies
that inventory against code and answers the one question the inventory does not: *can
`/preview` be deleted yet, and in what order.*

Baseline: `claude/integration-candidate` at `f55ec78`. That branch stacks twelve pull requests
including WS-03 document appearance and WS-02 favourites, both of which close rows the
inventory still records as `open`. Auditing against `integration/dogfood` would report those
patterns as unported.

Method: every verdict below was checked by reading the production implementation, not by
matching a filename. Where the real implementation exists but diverges from the reference, the
divergence is stated rather than absorbed into a `PORTED` verdict.

## Verdicts used

| Verdict | Meaning |
| --- | --- |
| `PORTED` | A production route implements it. The cited file and symbol were read. |
| `NOT PORTED — MVP` | Still required for personal dogfood, no production destination yet. |
| `NOT PORTED — FUTURE` | Deliberately deferred. Named FUT ticket, or a note that one must be filed. |
| `FIXTURE ONLY` | Scaffolding with no accepted pattern behind it. Safe to delete with the route. |

## 1. What `/preview` actually contains

Eleven files, 10,331 lines, of which 5,060 are one CSS module.

| File | Lines | Holds |
| --- | --- | --- |
| `web/src/app/preview/page.tsx` | 2,646 | Shell, sidebar, all workspace and planner surfaces, home, search, settings, notifications |
| `web/src/app/preview/preview.module.css` | 5,060 | The entire Preview stylesheet |
| `web/src/app/preview/states.tsx` | 755 | Ten system states, command palette, capture composer |
| `web/src/app/preview/perimeter.tsx` | 418 | Sign in, sign up, reset, onboarding, marketing aside |
| `web/src/app/preview/context-panel.tsx` | 388 | AI / Properties / Links right panel |
| `web/src/app/preview/operation-proposal.tsx` | 325 | AI proposal → running → receipt → cancelled |
| `web/src/app/preview/preview-data.ts` | 323 | Fixture pages, goals, actions, notifications |
| `web/src/app/preview/align-surfaces.tsx` | 297 | Goals and horizons, Vision |
| `web/src/app/preview/tab-list.tsx` | 59 | Generic ARIA tablist |
| `web/src/app/preview/empty-state.tsx` | 44 | Empty-state block |
| `web/src/app/preview/layout.tsx` | 16 | The `PLANNER_UI_PREVIEW` gate |

### Styles

**There are no `/preview`-only rules in `globals.css`.** Every Preview element is styled through
`preview.module.css`; `grep` for a `className="…"` string literal across `web/src/app/preview/*.tsx`
returns nothing, and `globals.css` contains no `.preview*` selector. The stylesheet dies with the
directory and needs no separate cleanup pass.

`globals.css` mentions `/preview` in four comments (lines 39, 59, 2312, 6552, 6774) that credit the
reference for a token contract or a ported layout. Those are prose about a design decision, not
dependencies; they should be reworded, not deleted, when the route goes.

### Assets — a deletion trap

`web/public/preview-focus-cover.png`, `preview-north-star-cover.png`, `preview-health-cover.png` and
`preview-product-cover.png` are referenced by `preview.module.css:641–653` **and** by production
code at `web/src/lib/notes/appearance.ts:39–57`, which serves them as the real Note cover library.
**These four files must survive the deletion.** Their `preview-` prefix now misdescribes them; a
rename is optional and, if done, must move `NOTE_COVERS` in the same commit.

## 2. Pattern inventory and verdicts

### 2.1 Shell and chrome

| Pattern | Verdict | Evidence |
| --- | --- | --- |
| Global rail, primary navigation | `PORTED` | `web/src/components/experience-shell.tsx` |
| Mobile menu / mobile bar | `PORTED` | `web/src/components/experience-shell.tsx`; `web/tests/e2e/keyboard-navigation.spec.ts` |
| Command palette | `PORTED` | `web/src/components/experience-shell.tsx`; `web/tests/e2e/shell-frame.spec.ts` |
| Sidebar tree with drag resizer | `PORTED` | `web/src/components/notes-shell.tsx`, `web/src/components/panel-resizer.tsx` (Preview imports the production resizer, so there is nothing to extract) |
| Theme control system/light/dark | `PORTED` | `web/src/components/theme-toggle.tsx:5–27` — same three-state order as `page.tsx:712 THEME_ORDER` |
| Top-bar account menu, notifications entry | `PORTED` | `web/src/components/experience-shell.tsx`; `/notifications` |
| Context panel three-tab framing | `PORTED (diverged)` | `web/src/components/notes-workspace.tsx:116 InspectorView`, tabs rendered at `:1190`. Real tabs are **Properties / Links / History**; Preview's were **AI / Properties / Links**. The AI tab's content lives in `assistant-dock.tsx` instead. This is a deliberate divergence — worth an owner's sign-off, not a port. |
| Context panel auto-open rule (open where it helps, closed when compact) | `NOT PORTED — MVP` | `notes-shell.tsx:50` initialises the pane unconditionally; there is no compact-width rule. Destination: `notes-shell.tsx` / `experience-shell.tsx`. Small, and it is a real responsive behaviour, so it should not be dropped silently. |
| Quick capture from the shell (`Quick capture` textarea, `Save capture`) | `NOT PORTED — MVP` | `experience-shell.tsx` has only navigation entries "Capture a thought" / "Capture an action" (lines 197, 206) that link to `/inbox`. There is no in-shell composer. Destination: `experience-shell.tsx` calling into the existing Capture Operation. |
| Voice capture control in the shell composer | `NOT PORTED — MVP` | Transcription is real (`web/src/components/dump-ui.tsx`), the shell placement is not. Same destination as above; ships with it or not at all. |
| Attach-file and `@`-mention buttons inside the capture composer | `NOT PORTED — FUTURE` | Depends on the shell composer above and on inline mentions. Needs a ticket; no FUT ticket currently covers capture-composer affordances. |

### 2.2 Workspace: document

| Pattern | Verdict | Evidence |
| --- | --- | --- |
| Markdown editing, autosave | `PORTED` | `web/src/components/notes-workspace.tsx`, `rich-markdown-editor.tsx` |
| Formatting controls | `PORTED` | `notes-workspace.tsx:1008–1140` |
| Note outline / document navigation | `PORTED` | `notes-workspace.tsx:1213` (`data-inspector-group="history"`, "Note outline") |
| Backlinks and note-to-note links | `PORTED` | `notes-workspace.tsx:1530` links section |
| Attachments | `PORTED` | `notes-workspace.tsx:611 uploadAttachment`, `:632 removeAttachment`, `:138 attachmentStatus` |
| **Cover image and reposition** | `PORTED` | `web/src/components/note-appearance-header.tsx` — cover band, "Change cover", "Remove cover", position slider committed on release; `web/src/lib/notes/appearance.ts`. Landed on this branch (`a5c9a79`); the inventory still says `open`. |
| **Page icon picker** | `PORTED` | `note-appearance-header.tsx:137–219`, validated by `normalizeNoteIcon` |
| **Favourite a page** | `PORTED` | `notes-workspace.tsx:336 toggleFavorite`, `:744 note-favorites`, `orderFavorites` in `web/src/lib/notes/note-paths.ts`. Landed on this branch (`e39bb95`, `f55ec78`). |
| Reorder / reparent controls | `PORTED` | `notes-workspace.tsx` move up/down/out, make child |
| Property strip (Status / Area / Review) | `NOT PORTED — FUTURE` | `page.tsx:1180 propertyStrip`. `note-appearance-header.tsx:17–27` records the reason: real Notes have no such fields, so building it would put invented data on a real page. It is the same capability as FUT-01 / [#141](https://github.com/KalebBefekadu/planner-ai/issues/141) (structured properties and views); file it there before deleting. |
| Block hover menu ("Block options: move, duplicate, delete") | `NOT PORTED — FUTURE` | No per-block menu exists in `rich-markdown-editor.tsx`. Needs a ticket; no FUT ticket covers block-level editing today. |
| Insert-below control | `NOT PORTED — FUTURE` | As above, same ticket. |
| Inline page mention (`@`) | `NOT PORTED — MVP` | Linking exists through the inspector (`notes-workspace.tsx:1530`), not inline. Destination: `rich-markdown-editor.tsx`. |
| Editor callouts (green / blue / coral / yellow) | `NOT PORTED — FUTURE` | `page.tsx:1144 toneClass`. Purely a styled block type; needs a ticket or explicit acceptance as dropped. |

### 2.3 Workspace: other modes

| Pattern | Verdict | Evidence |
| --- | --- | --- |
| Table view, "Add view", "Workspace views" switcher | `NOT PORTED — FUTURE` | `page.tsx:1793 TableView`, `:1103 WorkspaceTabs`. FUT-01 / [#141](https://github.com/KalebBefekadu/planner-ai/issues/141). |
| Knowledge graph view | `NOT PORTED — FUTURE` | `page.tsx:1887 GraphView` → FUT-02 / [#142](https://github.com/KalebBefekadu/planner-ai/issues/142) |
| Canvas view, "Add canvas item" | `NOT PORTED — FUTURE` | `page.tsx:1957 CanvasView` → FUT-02 / [#142](https://github.com/KalebBefekadu/planner-ai/issues/142) |
| Share dialog | `NOT PORTED — FUTURE` | `states.tsx:413 ShareState` → FUT-04 / [#144](https://github.com/KalebBefekadu/planner-ai/issues/144) |

Increment 1 closed this. Desktop and mobile references plus written specifications for all four
screens now live in [`preview-reference/`](preview-reference/README.md), and FUT-01, FUT-02 and
FUT-04 point at them.

### 2.4 Planner

| Pattern | Verdict | Evidence |
| --- | --- | --- |
| Plan surface, Goal hierarchy | `PORTED` | `web/src/components/planner-workspace.tsx`, `/planner` |
| Planning-horizon switcher | `PORTED` | `planner-workspace.tsx` ("Filter plan by horizon") |
| Today: focus list, completion, outcome menu | `PORTED` | `web/src/components/today-workspace.tsx`, `/planner/today` |
| Today: action composer | `PORTED` | `today-workspace.tsx` |
| Week calendar, previous/next week, day picker | `PORTED` | `web/src/components/planner-calendar.tsx:221,233` — same `Previous week` / `Next week` labels as `page.tsx:1475 PlannerCalendarView` |
| Planner inbox | `PORTED` | `/planner/inbox`, `web/src/components/capture-proposal-queue.tsx` |
| Review surface | `PORTED` | `/review`, `weekly-review.tsx`, `period-review.tsx` |
| Goals and horizons | `PORTED` | `/planner` (`/goals` is a `permanentRedirect` at `web/src/app/goals/page.tsx`), `planner-workspace.tsx` (Preview: `align-surfaces.tsx:88 GoalsHorizonsView`) |
| Vision | `PORTED` | `/vision`, `web/src/components/vision-ui.tsx` (Preview: `align-surfaces.tsx:227 VisionView`) |
| AI operation proposal card, run and receipt | `PORTED` | `web/src/components/review-ai-proposal.tsx`, `capture-proposal-queue.tsx` |

### 2.5 Secondary screens

| Pattern | Verdict | Evidence |
| --- | --- | --- |
| Home dashboard (`page.tsx:2022 HomeView`) | `PORTED (accepted divergence)` | The real product makes Today the entrance (`/`, `today-workspace.tsx`). Recorded as intentional. Its capture composer is tracked separately in 2.1. |
| Search view | `PORTED (partial)` | `web/src/app/search/page.tsx:101` gives the query field. **The scope filter is not ported**: Preview has `SearchScope = Everything / Pages / Actions / Projects` and a "Narrow results" control (`page.tsx:2132`); the real page has neither. The inventory records this row as fully `behavior`, which over-claims. Treat as `NOT PORTED — MVP`, destination `/search`. |
| Notifications | `PORTED` | `/notifications`, `notifications-center.tsx`. "Filter notifications" is an accepted divergence. |
| Settings sections (preferences, ai, memory, data, security) | `PORTED` | `/settings/*`, `settings-tabs.tsx` |
| Settings: integrations | `PORTED` | `/settings/mcp`, `mcp-token-manager.tsx` |
| Settings: account | `PORTED` | `/settings/account`, `account-summary.tsx` |
| "Related settings" cross-links | `PORTED` | `settings-tabs.tsx`, `web/src/app/settings/layout.tsx` |

### 2.6 Perimeter and onboarding

| Pattern | Verdict | Evidence |
| --- | --- | --- |
| Sign in, sign up, reset password, provider buttons | `PORTED` | `/login`, `/signup`, `/forgot-password`, `web/src/components/perimeter-shell.tsx` |
| Marketing aside | `PORTED` | `perimeter-shell.tsx` |
| Onboarding flow | `PORTED` | `/onboarding`, `onboarding-wizard.tsx`, `onboarding-center.tsx` |

### 2.7 System states

| Pattern | Verdict | Evidence |
| --- | --- | --- |
| Offline / waiting to sync | `PORTED` | `service-worker-registration.tsx`, `async-status.tsx` |
| **Conflict, side-by-side recovery** | `NOT PORTED — MVP` | `states.tsx:81 ConflictState` shows both versions and lets one be chosen. Production raises the conflict in words (`web/src/app/notes/actions.ts:430`, `today-workspace.tsx:88`) but offers no comparison surface. Destination: `notes-workspace.tsx`. This is the highest-value unported state — it is the one a person meets holding two real versions of their own writing. |
| AI unavailable / budget / error | `PORTED` | `assistant-dock.tsx` (retry at `:446`), `ai-usage-dashboard.tsx` |
| Permission denied | `PORTED (diverged)` | Operation failure messaging (`stableFailure`); there is no full-surface screen. Accepted. |
| Generic error | `PORTED` | `web/src/app/error.tsx` |
| Not found | `PORTED` | `web/src/app/not-found.tsx` |
| Trash | `PORTED` | `/trash`, `trash-manager.tsx:27,42,90` |
| Version history and restore | `PORTED` | `notes-workspace.tsx:1617–1662`, "Restore version N" |
| Empty-state pattern | `PORTED` | `.inline-empty` in `globals.css`, used by `planner-calendar.tsx`, `today-workspace.tsx` |
| Command palette overlay | `PORTED` | `states.tsx:538` → `experience-shell.tsx` |
| Capture composer overlay | `NOT PORTED — MVP` | `states.tsx:621 CaptureComposer`. Same item as the shell quick capture in 2.1. |

### 2.8 Fixture-only

| Item | Verdict |
| --- | --- |
| `preview-data.ts` — fixture pages, goals, actions, notifications, the "Sam" persona | `FIXTURE ONLY` |
| `PreviewIndex` stage navigator (`page.tsx:589–686`) — the floating menu that jumps between states | `FIXTURE ONLY` (it exists only because the states have no real trigger) |
| `SystemStateSurface` stage dispatcher (`page.tsx:572`) | `FIXTURE ONLY` |
| `layout.tsx` env gate | `FIXTURE ONLY` |
| `tab-list.tsx`, `empty-state.tsx` | `FIXTURE ONLY` — generic, but the real app already has equivalents; nothing to extract |
| `preview.module.css` | `FIXTURE ONLY` — reads shared tokens, declares none |

### Counts

| Verdict | Count |
| --- | --- |
| `PORTED` (41 clean, plus 4 recorded divergences) | 45 |
| `NOT PORTED — MVP` | 7 |
| `NOT PORTED — FUTURE` | 9 |
| `FIXTURE ONLY` | 6 |

## 3. Dependency scan

Everything outside `web/src/app/preview/` that imports it, routes to it, tests it or documents it.

### Runtime imports

**None.** `web/tests/unit/preview-isolation.test.ts` asserts this and passes. The dependency runs
only the other way: Preview imports `@/components/panel-resizer` and `@/lib/use-dialog`, and that
same test pins the list to exactly those two.

### Route references

| Reference | File | Effect of deletion |
| --- | --- | --- |
| `pathname === '/preview'` in the public-route allowlist | `web/src/lib/supabase/middleware.ts:50` | Must be removed; harmless dead condition if left |
| `PLANNER_UI_PREVIEW=enabled` in the Playwright web server | `web/playwright.config.ts:57` | Must be removed |
| `PLANNER_UI_PREVIEW: enabled` (two jobs) | `.github/workflows/ci.yml:105,113` | Must be removed |
| `PLANNER_UI_PREVIEW=disabled` | `web/.env.example:31` | Must be removed |

### Test references — the blocking set

| Test | What it does | Effect of deletion |
| --- | --- | --- |
| `web/tests/e2e/auth-boundary.spec.ts:24,48` | Two tests navigate `/preview` and assert the unauthenticated shell, page switching and Planner/Settings navigation | **Both break.** They are the only proof that a public route stays public; rewrite against `/login` before deleting |
| `web/tests/e2e/accessibility.spec.ts:9` | Runs axe over `/preview` | **Breaks.** `/preview` is one of five unauthenticated axe targets; the authenticated suite covers the rest |
| `web/tests/unit/preview-isolation.test.ts` | Whole file is about Preview | Delete with the route |
| `web/tests/unit/state-pages.test.ts:134` | Asserts no real personal data in Preview fixtures | Delete that case only; the rest of the file covers `error.tsx` / `not-found.tsx` and must stay |

### Documentation references

`README.md:50`; `docs/README.md:13`; `docs/status.md:40,63`; `docs/roadmap.md:45,61,67`;
`docs/product/experience.md:170,172`; `docs/product/preview-inventory.md` (whole file);
`docs/qa/qa-01-sweep.md:61`; and this file. Comments in `globals.css` (39, 59, 2312, 6552, 6774),
`web/src/app/error.tsx:6`, `web/src/components/panel-resizer.tsx:7`,
`web/src/components/notes-workspace.tsx:778`, `note-appearance-header.tsx:17`.

### Assets

The four cover PNGs in `web/public/` are shared with production (`appearance.ts:39–57`). Not a
blocker, but a real hazard if deletion is done by prefix.

## 4. Can deletion begin now?

**No — not the route, and not any screen that is still the only record of a deferred design.**

Two facts soften that. First, the isolation test proves nothing in production depends on Preview
code, so this is a documentation and test problem, not an architectural one. Second, `layout.tsx`
already returns 404 unless `PLANNER_UI_PREVIEW=enabled`, so Preview is **not shipping in
production today**. The urgency of "one real app" is largely already satisfied; the remaining
risk of keeping the directory is drift and maintenance, not user-visible duplication. That
argues for doing the preconditions properly rather than deleting fast.

### Recommended increments

**Increment 0 — correct the inventory (do first; no code change).**
Move cover image, page icon and favourite from `open` to implemented, citing
`note-appearance-header.tsx` and `notes-workspace.tsx:336`. Downgrade the Search row: the scope
filter is not ported. Add the property-strip, block-menu, insert-below and callout rows, which
the inventory does not currently list at all.
*Precondition: none. This is the cheapest way to stop the checklist being wrong.*

**Increment 1 — capture the deferred references into their FUT tickets.**
Attach desktop and mobile screenshots of Table, Graph, Canvas and Share to #141, #142, #144.
File the two missing tickets: block-level editing (block menu, insert-below, callouts) and the
capture-composer affordances (attach, `@`-mention). Move the property strip into #141.
*Precondition: Increment 0. This is the acceptance criterion "no accepted pattern disappears
without a working destination or explicit future specification", and nothing else can be deleted
until it holds.*

**Increment 2 — delete only the four deferred screens.**
Remove `TableView`, `GraphView`, `GraphNode`, `CanvasView`, `WorkspaceTabs`, `ShareState` and
their CSS. `/preview` keeps working; the shell and every MVP surface stay.
*Precondition: Increment 1 complete and the screenshots merged. `npx vitest run` green
(`preview-isolation` will need its import list unchanged — it is).*

**Increment 3 — close the six MVP gaps under their own tickets, not under UI-03.**
Shell quick capture with voice (WS-04 / #125), the conflict recovery surface (WS-01 / #122),
inline `@`-mention (WS-02 / #123), context-panel auto-open (WS-03 / #124), search scope filter
(WS-02 / #123). Each keeps its Preview screen alive as the reference until its port lands.
*Precondition: none — these are independent and can start immediately in parallel with 1 and 2.*

**Increment 4 — move the two e2e tests off `/preview`.**
Rewrite the `auth-boundary` public-route tests against `/login`, and swap the axe target for an
authenticated route already in the corpus.
*Precondition: Increment 3, so that no rewritten test loses coverage of a pattern that only
Preview still demonstrates. This is the last thing that makes deletion mechanically possible.*

**Increment 5 — delete the route.**
Remove `web/src/app/preview/`, `preview-isolation.test.ts`, the fixture case in
`state-pages.test.ts:134`, the middleware allowlist entry, the `PLANNER_UI_PREVIEW` variable in
`playwright.config.ts`, `ci.yml` and `.env.example`. **Keep the four cover PNGs.** Rewrite the
documentation references, and replace `preview-inventory.md` with a pointer to this audit.
*Precondition: Increments 1–4 all complete, plus a production build and the full affected journey
suite, per #140's verification section.*

## Where a human eye is needed

1. **The context panel's third tab.** Preview offered AI; production offers History. Both are
   defensible. Someone has to decide whether the AI-in-the-inspector idea is dropped or deferred,
   because right now it is neither.
2. **Search scope.** Whether "Everything / Pages / Actions / Projects" is a real need for a
   single-owner workspace, or scope filtering that only made sense against fixture breadth.
3. **Editor callouts.** Coloured callout blocks are a Markdown extension decision, not just a
   style. Dropping them silently would be the easiest loss in this list.
4. **The four cover PNGs' names.** Cosmetic, but they will read as leftovers after the route goes.
