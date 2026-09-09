# Preview reference captures (UI-03, Increment 1)

Owning ticket: [UI-03 / #140](https://github.com/KalebBefekadu/planner-ai/issues/140).
Audit: [preview-extraction-audit.md](../preview-extraction-audit.md).

`/preview` is the internal design reference and is being retired. Four of its screens hold
patterns that are deliberately deferred rather than ported, so deleting them would erase the
only record of the design. This directory is that record: desktop (1440x900) and mobile
(390x844) captures of each deferred screen, plus a written specification detailed enough to
rebuild the screen without the image.

All content in these images is Preview fixture data (the "Sam" persona from
`web/src/app/preview/preview-data.ts`). No real workspace content appears in any capture.

Captured from `web/src/app/preview/` with `PLANNER_UI_PREVIEW=enabled` against the local dev
server. Preview is fixture-backed, so no database or authenticated workspace was involved.

| Screen | Desktop | Mobile | Owning ticket |
| --- | --- | --- | --- |
| Table / workspace views | `table-desktop.png` | `table-mobile.png` | FUT-01 / [#141](https://github.com/KalebBefekadu/planner-ai/issues/141) |
| Property strip | `property-strip-desktop.png` | — | FUT-01 / [#141](https://github.com/KalebBefekadu/planner-ai/issues/141) |
| Knowledge graph | `graph-desktop.png` | `graph-mobile.png` | FUT-02 / [#142](https://github.com/KalebBefekadu/planner-ai/issues/142) |
| Vision canvas | `canvas-desktop.png` | `canvas-mobile.png` | FUT-02 / [#142](https://github.com/KalebBefekadu/planner-ai/issues/142) |
| Share dialog | `share-desktop.png` | `share-mobile.png` | FUT-04 / [#144](https://github.com/KalebBefekadu/planner-ai/issues/144) |
| Block controls | `block-controls-desktop.png` | — | block-level editing ticket |

Editor callouts are **not** captured here. They were dropped by owner decision in #216 and are
not a deferred pattern.

---

## 1. Table view and the workspace-view switcher

Source: `web/src/app/preview/page.tsx` — `TableView` (`:1793`), `WorkspaceTabs` (`:1103`).
Images: `table-desktop.png`, `table-mobile.png`.

**View switcher.** A tab strip sits directly under the top bar, above the surface, and is
present on every workspace page: `Document`, `Projects` (table), `Graph`, `Canvas`, then a `+`
button to add a view. The active tab carries an underline. The same three non-document views
also appear in the sidebar tree under a `VIEWS` section (`Projects`, `Knowledge graph`,
`Vision canvas`), so a view is reachable both as a tab on the current page and as a
navigable item in the tree. Selecting any view replaces the document body only; rail,
sidebar, top bar and context panel are unchanged.

**Database header.** A square tinted icon tile, the database title as an h1, and a one-line
count subtitle (`12 projects · 4 active`). A primary `+ New project` button is right-aligned
on the same row.

**Toolbar.** Two groups on one row. Left: the view-type switcher — `Table`, `Board`,
`Calendar` — where the active type is underlined and emphasised. Right: `Filter`, `Sort` and
an icon-only search button. The toolbar is the per-view control surface; the tab strip above
it is the per-page one. These are two different levels and both are needed.

**Table.** Columns are `Project`, `Status`, `Priority`, `Target`, `Progress`, and a trailing
unlabelled column holding a per-row overflow button whose accessible name is
`Open <row title>`. The title cell pairs a small emoji/icon with the title in semibold.
Status renders as a tinted pill with a per-status colour (in progress, on track, planning,
paused). Progress renders as a thin filled bar followed by the percentage as text — the number
is never conveyed by the bar alone. A full-width `+ New project` row sits under the last row
and adds a record inline rather than opening a dialog.

**Mobile.** The rail collapses to a bottom bar and the sidebar to a hamburger; the tab strip
stays and scrolls horizontally; the table scrolls horizontally inside its own container, with
`Project` and `Status` visible at 390px. The page never scrolls horizontally as a whole.

## 2. Property strip

Source: `web/src/app/preview/page.tsx:1180` (`propertyStrip`).
Image: `property-strip-desktop.png`.

A horizontal row of page properties between the document title block and the first paragraph,
separated from both by hairline rules. Each property is a button showing a muted label and the
value in semibold: `Status` (rendered as a tinted pill), `Area` (icon + text), `Review`
(text). A trailing `+ Add property` button ends the row. Clicking a property is intended to
open its editor in place; the strip is not a read-only summary.

This is the same capability as FUT-01's typed properties, which is why it belongs to #141 and
not to a note-header ticket: `web/src/components/note-appearance-header.tsx:17-27` records
that real Notes have no such fields, so building the strip before the property model exists
would put invented data on a real page.

## 3. Knowledge graph

Source: `web/src/app/preview/page.tsx` — `GraphView` (`:1887`), `GraphNode` (`:1935`).
Images: `graph-desktop.png`, `graph-mobile.png`.

**Toolbar.** A "spatial toolbar" shared with Canvas: a title (`Knowledge graph`) with a
secondary count line (`28 pages · 46 connections`) on the left, and `Find`, `Filter`,
`Center` on the right. `Center` re-frames the viewport on the focused node.

**Surface.** A dotted-grid canvas filling the remaining space. Nodes are rounded white cards
carrying an icon and a short label, not bare circles — the label is always visible and is not
a hover-only tooltip. One node is the focus node and is rendered larger and emphasised
(`Personal OS` in the fixture); the rest are its neighbours. Edges are thin straight lines
drawn behind the nodes.

**Legend.** A pill anchored bottom-left maps three node colours to `Page`, `Goal`, `Action` —
the graph is heterogeneous by design; it links notes to planning objects, not just notes to
notes.

**Mobile.** The toolbar keeps one row — the title and count wrap to two lines on the left,
`Find` / `Filter` / `Center` stay on the right. The surface keeps the same node set and
relative arrangement rather than becoming a list, and the legend stays anchored bottom-left.

**Requirements this reference implies.** Every node maps to a real Note, Goal or Action;
edges come from real relationships. Nodes are buttons — keyboard reachable and activatable,
with an equivalent list-based route to the same relationships for anyone not using a pointer.

## 4. Vision canvas

Source: `web/src/app/preview/page.tsx` — `CanvasView` (`:1957`).
Images: `canvas-desktop.png`, `canvas-mobile.png`.

**Toolbar.** The same spatial toolbar: title `Vision canvas` with a save-state line
(`Saved just now`) on the left; undo, `+ Add` and `Share` on the right.

**Surface.** A free-placement dotted surface holding two kinds of object:

- *Groups* — dashed-outline regions with an uppercase label (`DIRECTION`, `NOW`) that frame an
  area of the canvas. They are containers with a title, not cards.
- *Cards* — four distinct card types, each with a small uppercase kind label:
  - `VISION`: icon plus a single large statement.
  - `Q3 GOAL`: title, one-line description, and a progress bar.
  - `PRINCIPLE`: title and one-line description.
  - `THIS WEEK`: a short checklist of actions with checked/unchecked states.

A circular `+` floating button in the corner has the accessible name `Add canvas item`.

**Mobile.** The surface keeps its spatial arrangement rather than reflowing to a list: the
same groups and cards stay in place, scaled down, and the group regions overlap at 390px. The
toolbar keeps undo, `Add` and `Share` on one row under the title. Preserving the spatial
layout on a small screen is a design question this reference leaves open — the fixture shows
what it currently does, not what it should do.

**Requirements this reference implies.** Placement must persist (the `Saved just now` line is
a promise of a persistence model, and undo implies a mutation history). Cards are views onto
real Vision, Goal and Action records, not free-floating text — which is what distinguishes
this from a generic whiteboard. Because placement is spatial, a keyboard route for creating
and moving items is required, not optional.

## 5. Share dialog

Source: `web/src/app/preview/states.tsx:413` (`ShareState`).
Images: `share-desktop.png`, `share-mobile.png`.

Opened from a `Share` button in the workspace top bar. A centred modal over a scrim, with
`role="dialog"`, `aria-modal="true"`, labelled by its heading, dismissed by the scrim, by the
close button, and by Escape (the shared `useDialog` hook).

**Heading.** `Share "<page title>"` — the dialog always names the exact page, never "this
page". A close button sits at the right of the header row.

**Access options.** A radio group, legend `Who can open this page`, three mutually exclusive
choices, each an icon + bold label + explanatory line, with the selected row tinted:

| Option | Label | Explanation |
| --- | --- | --- |
| `private` | Only me | The default. Nothing leaves your workspace. |
| `link` | Anyone with the link | Read only. The link can be revoked at any time. |
| `people` | Specific people | Invite by email. Each person signs in to read. |

`Only me` is selected on open. That default is part of the specification, not an accident of
the fixture.

**Link row.** Choosing `Anyone with the link` reveals a row below the options: a globe icon,
the share URL in a monospace `code` element, and a `Copy` button. Choosing anything else
hides it again. There is no separate "generate link" step.

**Footer note.** A persistent one-line caution with an alert icon: shared readers see the page
and its properties, and never the owner's other pages, plan, or assistant proposals. This
sentence is the sharing scope contract in plain words and should survive into whatever
FUT-04 builds.

**Mobile.** The Preview shell hides the top-bar `Share` entry below 900px, so Preview offers
no mobile entry point to this dialog; `share-mobile.png` was captured by opening the dialog at
desktop width and narrowing the viewport, which records the dialog's own responsive
rendering. A real implementation needs a mobile trigger — the overflow menu is the obvious
home for it.

## 6. Block controls (block hover menu, insert below)

Source: `web/src/app/preview/page.tsx:1241-1247` (`blockHandle`).
Image: `block-controls-desktop.png`.

A two-button handle in the left gutter of the editor column, offset outside the text measure
and rendered at reduced opacity until hovered:

- `+` — accessible name `Insert a block below`. Inserts a new block after the current one.
- Grip (vertical dots) — accessible name `Block options: move, duplicate, delete`. Opens a
  per-block menu offering exactly those three operations, and is also the drag handle for
  reordering.

Nothing equivalent exists in `web/src/components/rich-markdown-editor.tsx` today: the real
editor has document-level formatting controls but no per-block affordance. A keyboard route to
both operations is required, since a gutter handle revealed on hover is pointer-only.
