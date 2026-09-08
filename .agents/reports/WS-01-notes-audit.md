# WS-01: Notes Convergence Audit

Task: `.agents/tasks/WS-01-notes-audit.md`
Owner: Claude (independent read-only audit)
Branch: `claude/ws-01-notes-audit`
Roadmap stage: 2 — Workspace And Notion Pilot
Predecessor: `.agents/reports/BR-01-claude-audit.md` (frame-level audit). This report does not repeat it; it narrows to Notes and to the post-BR-02/WS-02 tree.

Evidence base: `web/src` at this branch. For every file named below, this branch is identical to `origin/integration/dogfood`, plus the two `codex/ws-02-notes-workspace` commits (`5ec66a8`, `baa0475`) which are treated as landed per the task briefing. Nothing outside `.agents/reports/WS-01-notes-audit.md` was modified.

---

## 1. What WS-02 already settled, and what it did not

WS-02 removed the **duplicate generic sidebar**, not the duplicate **column**. The mechanism is a route-scoped class:

- `experience-shell.tsx:88` sets `contentOwnsSidebar = pathname === '/notes'`; `:328` then renders `{sidebarOpen && !contentOwnsSidebar ? sidebar : null}`, so the shell's generic Workspace menu is suppressed on `/notes`.
- `globals.css` `.experience-content-sidebar` collapses the shell grid to `56px minmax(0, 1fr)` and zeroes `.experience-main` padding, letting `.notes-shell` supply column two.
- `.notes-shell` `min-height` was corrected from `calc(100vh - 96px)` to `calc(100vh - 50px)`, and `.notes-sidebar` was repointed at `--experience-sidebar`, so the Notes tree now reads as the shell sidebar rather than as a panel inside the work area.

**What that leaves.** The real Notes route is now `rail → notes tree → editor → inspector`. The accepted Preview frame is `rail → sidebar → main → context` (`preview.module.css:2495`, `.contextPanel` as a top-level grid child of `.previewRoot`). Those look like the same four columns, but the fourth is in the wrong place: the real inspector is `.note-content-layout`'s second grid track (`globals.css:2261-2265`, `minmax(0,1fr) 286px`), nested **inside** the editor pane, below the note header and the Markdown toolbar. In the reference it is a sibling of the whole work area, full height, with its own header and tabs.

Three consequences follow, and they are the substance of the next slice:

1. **The inspector cannot be full height, and is clipped instead.** `globals.css:2440-2444` pins `.note-inspector` to `max-height: calc(100vh - 224px)` with `overflow-y: auto` — the same hardcoded-chrome assumption WS-02 just removed from `.notes-shell`, surviving one layer down. `224px` encodes the note header plus toolbar heights; any header change silently mis-sizes it.
2. **The panel is a single 470-line scroll of eight stacked sections** (`notes-workspace.tsx:881-1352`): Outline, Filing, Attachments, Tags, Plan connections, Links, History, File captures. The reference groups the same material behind three tabs (`context-panel.tsx:73-77`: AI / Properties / Links). Finding a backlink today means scrolling past attachments and tags in a 286px column.
3. **The assistant is not in the context column at all.** `experience-shell.tsx:234` and `:276` mount `AssistantDock` twice as a floating dock. The reference puts the assistant in the context panel's first tab, scoped to the current document (`context-panel.tsx:55`, "Working with {contextLabel}").

---

## 2. Recommended slice: lift the Note inspector into a shared context column

**One ticket. No schema change, no new Operation, no migration, no AI change.** It is a layout and grouping change over data the route already loads.

### 2.1 Why this one

Measured against the other stage-2 candidates:

| Candidate | Cost | Why not first |
| --- | --- | --- |
| **Inspector → shell context column** | layout + grouping only | **Recommended.** Pure presentation over existing loaders; unblocks every item below |
| Document header (cover, icon, property strip) | new columns/table + migration | Roadmap forbids presentation metadata in `body_markdown`, so this needs schema. One migration owner at a time (`.agents/README.md:33`) |
| Favorites in the tree | new `favorite` field | No such field on `NoteView` (`app/notes/actions.ts:9-18`). Schema first |
| Import/export polish | none needed | `status.md:47-53` records the vault round-trip and restore as already proven with browser evidence. Lowest marginal value |
| Search / backlinks depth | moderate | Backlinks already load (`NoteKnowledgeContext.links`); the gap is that they are unfindable in the panel — which this slice fixes |

It also materially advances the Notion-replacement goal on its own terms: properties, backlinks, and history are the three things a person opens a Notion page's side panel for, and today all three are buried in one clipped scroll.

### 2.2 Scope

**a. Add a context slot to the shell.** `experience-shell.tsx` grows an optional `context` region and an `experience-context-open` state, mirroring the existing `sidebarOpen` pattern at `:89-95`. `.experience-shell` grid (`globals.css:177-182`) gains a fourth track; `.experience-content-sidebar` becomes `56px minmax(0,1fr) var(--experience-context-w, 320px)`.

**b. Extract `ContextPanel` as a shared, props-only component** at `web/src/components/shell/context-panel.tsx`, ported from `app/preview/context-panel.tsx:45-88` (header + `TabList` + `role="tabpanel"`). Move `app/preview/tab-list.tsx` to `web/src/components/shell/tab-list.tsx` — it is already generic, correct (arrow-key roving tabstop, one tab stop, `aria-controls`) and fixture-free. Per BR-01 §4.1 the import direction is one-way: `app/preview/**` becomes a caller.

**c. Regroup the eight inspector sections into three tabs**, keeping every existing control and handler verbatim:

| Tab | Sections moved | Current lines |
| --- | --- | --- |
| Properties | Filing, Tags, Attachments, Plan connections | `905-949`, `1062-1186`, `951-1019`, `1187-1273` |
| Links | Links + backlinks, File captures | `1274-1327`, `1328-1352` |
| History | Outline, revisions/restore | `882-903`, `1328-...` (`restoreNoteRevision`) |

The reference's third tab is `AI`; **use `History` instead for this ticket** and leave `AssistantDock` where it is. Moving the assistant into the panel means reworking evidence, claims, proposals and undo (`assistant-dock.tsx`) and belongs in its own ticket. Keep the tab id space open for it.

**d. Delete the nested column.** `.note-content-layout` (`globals.css:2261-2265`) collapses to a single track; `.note-inspector`'s `max-height: calc(100vh - 224px)` (`:2440`) is removed outright — the panel is a grid child of a `100vh` shell and no longer needs to guess at the chrome above it.

### 2.3 Files

| File | Change |
| --- | --- |
| `web/src/components/shell/context-panel.tsx` | new — ported from `app/preview/context-panel.tsx:45-88` |
| `web/src/components/shell/tab-list.tsx` | new — moved from `app/preview/tab-list.tsx` |
| `web/src/app/preview/context-panel.tsx` | import the shared shell components; delete the duplicated markup |
| `web/src/app/preview/tab-list.tsx` | delete; re-export or update ~4 import sites |
| `web/src/components/experience-shell.tsx` | context slot, open/close state, grid class |
| `web/src/components/notes-workspace.tsx` | `881-1352` regrouped into three tab panels and rendered into the shell slot |
| `web/src/app/globals.css` | `177-182`, `2261-2265`, `2440-2456`, `5952-5965` |
| `web/src/lib/experience-navigation.ts` | only if the context slot is described in the navigation model |

`experience-shell.tsx` and `globals.css` are the collision-sensitive files (`.agents/README.md:33`, BR-01 §6.10). Both are also touched by any parallel frame ticket — this must be the single writer while it runs.

### 2.4 Explicitly out of scope

Cover image, page icon, property strip, favorites, block handles, table/graph/canvas tabs, sharing, assistant relocation. BR-01 §2.2 classifies each; all of them are either post-dogfood or schema-blocked.

---

## 3. Authoritative real behavior that must survive unchanged

Everything in this section already works and is the reason a rebuild-from-Preview would be a regression.

**Loaders.** `app/notes/page.tsx:10` gates on `PLANNER_DATA_MODEL === 'canonical'` and `notFound()`s otherwise; `:12-14` loads `getNotes(q)` then `getNoteKnowledgeContext(activeId)` and defaults the active note to `notes[0]`.

**Authorization.** `actions.ts:56-70` (`notesClient`) is the single choke point: it re-reads the user via `supabase.auth.getUser()` and resolves the workspace by `owner_user_id` on every call. `getNotes` (`:88-107`) additionally filters `workspace_id`, `archived_at is null`, `trashed_at is null`. Full-text search runs server-side via `textSearch('search_vector', …, {type:'websearch'})` — not client filtering.

**Operations.** All eighteen mutations go through `executeOperation(supabase, '<name>.v<n>', …, { idempotencyKey: randomUUID(), surface: 'ui' })` — `note.update.v1`, `note.ai-exclusion.v1`, move/reparent/file, archive, tags, link/unlink, revision restore, goal/action links (`actions.ts:246-630`). No shared component may import a Server Action; the panel receives callbacks.

**Editor state and autosave.** `versionRef` (`:122`) carries optimistic-concurrency state; `queueAutosave` (`:265-300`) serializes writes through `queuedDraftRef` and **re-queues the draft on failure** (`:287`) so input is never lost; a 302-314 debounce keys on `activeNoteId`; `:316-320` adopts a newer server version. `saveState` (`:123`, rendered `:584-590`) is the real save indicator BR-01 flagged as the replacement for the shell's hardcoded status. `status.md:32` records that a conflicting save must report the conflict in actionable words — do not let a layout change route that message through a generic error surface.

**Remount contract.** `notes-shell.tsx:9-22` documents a real defect: the workspace is remounted per active note (`key={activeKey}`), and the import dialog is deliberately held **above** it so an import report survives the `router.refresh()` the import causes. The context panel must sit on the shell side of that boundary or share the same remount key as the editor — not straddle them.

**Rich-editor guard.** `richEditable` disables rich mode and shows `note-editor-notice` (`:854-859`) when the Markdown contains constructs the adapter cannot round-trip. Source-authoritative Markdown is the contract; the panel must never write to `body_markdown`.

**Import/export/recovery.** `commitNoteImport` (`:262`), `api/notes/export`, `api/note-import`, `lib/notes/{import,import-bundle,export-vault,sibling-order}.ts`. `status.md:47-53` lists six defects already fixed here (manifest identity, frontmatter stripping, filename collisions, nested hierarchy, trailing newline, sibling order). This slice touches none of it and must not.

---

## 4. Responsive and accessibility risks

**4.1 Three columns do not fit, and the current fallbacks disagree.** `globals.css:5952-5965` collapses `.note-content-layout` to one column and unpins `.note-inspector` at the narrow breakpoint. WS-02 added `.experience-content-sidebar.experience-sidebar-collapsed .notes-sidebar { display: block }` in the same block — so on mobile the tree reappears *above* the editor. Adding a fourth column means deciding, once, what mobile does with the context panel: the reference makes it `position: fixed` overlay below `1180px` (`preview.module.css:2849-2851`). Adopt the overlay; do not stack a third full-width region under an editor that already stacks two.

**4.2 `status.md:34` records reflow at 320 CSS px as a verified, non-vacuous gate.** A fourth track is exactly the change that breaks it. `reflow-and-motion.spec.ts` must run on this ticket, not at the stage gate.

**4.3 Heading levels.** The eight sections are `<h2>` (`notes-workspace.tsx:883` ff.) inside an `aria-label`led `<aside>`. Tabs replace seven visible headings with three tab labels; the surviving panel headings must stay a coherent outline, and each panel needs `role="tabpanel"` + `aria-labelledby` + `tabIndex={-1}` as `context-panel.tsx:79` already does.

**4.4 The panel toggle must be keyboard-reachable and focus-managed.** `useDialog` (`lib/use-dialog.ts`) is the existing shared contract for the mobile overlay case; reuse it rather than hand-rolling focus return.

**4.5 No dynamic `style` attribute.** `--experience-context-w` must be written through `style.setProperty` as `experience-shell.tsx` already does for the sidebar width. `status.md:31` records that a CSP nonce does not extend to style attributes, so an attribute-sized column would silently fall back to its default **only in a production build**.

**4.6 Reduced motion.** Panel open/close must use the existing global duration collapse (`globals.css`, per `status.md:33`) rather than a new transition.

---

## 5. Likely tests

**Unit (Vitest).**
- New `web/tests/unit/note-context-panel.test.ts`: the three tab groupings render the sections they claim; the panel receives callbacks and imports no Server Action.
- Extend `web/tests/unit/design-tokens.test.ts` — it already grew assertions in both BR-02 and WS-02 and is the natural home for a `--experience-context-w` / fourth-track assertion.
- Re-run `web/tests/unit/form-labelling.test.ts`; the panel contains the filing `<select>`, tag inputs, and link controls it asserts on.

**Browser (Playwright, production build — mandatory per `status.md:110`).**
- Extend `journey-notes.spec.ts`: open the panel, restore a revision from the History tab, add and remove a link from the Links tab, and confirm the **import report still survives `router.refresh()`** (the `notes-shell.tsx:9-22` case).
- Extend `authenticated-accessibility.spec.ts`: scan with the panel open, light and dark. `status.md:41` warns the dark scan previously measured mid-transition colours — settle transitions first.
- Re-run `reflow-and-motion.spec.ts` (§4.2), `keyboard-navigation.spec.ts`, and `auth-boundary.spec.ts` (WS-02 already edited it, so it is live).
- `security-headers.spec.ts` must stay green — §4.5 must not widen the CSP.

Gate: `cd web && npm run agent:check`, plus the specs above.

---

## 6. Risks and open items

1. **`.note-inspector`'s `calc(100vh - 224px)` is the same class of bug WS-02 just fixed one layer up.** Removing it is part of the slice, not a follow-up; leaving it while adding a shell column produces a panel that is both full-height and clipped.
2. **Regrouping eight sections into three tabs is a findability change a person will notice.** Tag editing and attachments move behind a tab that is not open by default. Default the panel to Properties.
3. **`experience-shell.tsx` + `globals.css` are single-writer.** This ticket cannot run concurrently with another frame ticket.
4. **`contentOwnsSidebar = pathname === '/notes'`** (`experience-shell.tsx:88`) is a hardcoded route string. It is correct today and out of scope here, but every future route that owns its sidebar will extend that literal. Worth a typed predicate when a second such route appears — flagged, not proposed.
5. **Open decision for the Codex lead:** whether the third tab is `History` (recommended here) or `AI`. Choosing `AI` pulls `assistant-dock.tsx` into scope and roughly doubles the ticket.
6. **Outside writable paths:** no `web/**` change was made by this ticket. Every file in §2.3 belongs to the follow-on implementation ticket.

---

## Handoff

- **Behavior changed:** none. Read-only audit.
- **Files changed:** `.agents/reports/WS-01-notes-audit.md` (new) only. No source, test, migration, roadmap, or status file was touched.
- **Checks run:** read-only inspection of `web/src/app/notes/**`, `web/src/components/notes-*`, `web/src/app/globals.css`, `web/src/components/experience-shell.tsx`, `web/src/lib/experience-navigation.ts`, and `web/src/app/preview/**`; `git diff origin/integration/dogfood origin/codex/ws-02-notes-workspace` to establish the post-WS-02 baseline. No build, lint, or test was run — this ticket changes no product code, so `npm run agent:check` would only re-report the state already recorded in `docs/status.md`.
- **Known risks/blockers:** §6.5 (History vs AI for the third tab) is a lead decision, though the recommended answer is unblocked. §6.3 (single-writer on `experience-shell.tsx` and `globals.css`) constrains scheduling. §4.5 and §4.2 are the two findings most likely to make otherwise-correct work fail only in a production build.
- **Commit SHA:** recorded below on commit.
