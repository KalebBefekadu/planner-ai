# QA-01: integrated release check evidence

Ticket: [QA-01](https://github.com/KalebBefekadu/planner-ai/issues/136)
Commit: `3918eaf8c5e8c679d9b2ea1a1c74cf085c5895cb` (`claude/br-02-shell-frame`)
Recorded: 2026-09-11

This records one run of every gate that can be run locally, plus the risks that
remain. It is **not** a claim that QA-01 is met: the acceptance criteria require
a deployed environment, and nothing here has left a local stack.

## Environment

| | |
| --- | --- |
| Build | production (`next build`, as `playwright.config.ts` starts it) |
| Database | local Supabase stack, `PLANNER_DATA_MODEL=canonical` |
| Preview route | `PLANNER_UI_PREVIEW=enabled` |
| AI provider | none configured; outage paths exercised, live provider not |
| Profiles | Chromium desktop, and Pixel 7 (`mobile-chromium`) |

## Gate counts

| Gate | Result |
| --- | --- |
| `npm run agent:check` (prettier, eslint, tsc) | clean |
| Unit (`vitest`) | **868 passed**, 0 failed |
| Database (`supabase test db`) | **63 files, 1138 assertions, PASS** |
| Browser, desktop | **169 passed, 0 failed, 1 skipped** |
| Browser, mobile | **149 passed, 0 failed, 21 skipped** |

### Every skip, and why

Skips are recorded rather than counted as passes, per the ticket.

| Reason | Where |
| --- | --- |
| "This journey verifies the mobile drawer." | 1 desktop skip; the same journey runs on mobile |
| "The rail is the desktop navigation frame." | mobile |
| "The sidebar is the desktop navigation frame." | mobile |
| "The palette shortcut is a desktop keyboard affordance." | mobile |
| "Dragging a panel is a desktop affordance." | mobile |
| "The mobile launcher is covered by the outage journey." | mobile |
| "These conditions are set by the test, not by the device profile." | mobile |

Every skip names a surface that does not exist on that profile and is covered on
the other. No skip hides a failure.

## What the checks in scope item 2 actually cover

| Check | Covered by | State |
| --- | --- | --- |
| Keyboard | `keyboard-navigation.spec.ts`, palette focus return in `shell-frame.spec.ts` | automated |
| Reduced motion | `reflow-and-motion.spec.ts` | automated |
| Contrast / WCAG A+AA | `accessibility.spec.ts`, `authenticated-accessibility.spec.ts` (19 authenticated routes, light and dark) | automated |
| Small screen and reflow | `reflow-and-motion.spec.ts` at 320 CSS px | automated |
| Large Notes and trees | `notes-at-scale.spec.ts` (1400 Notes, 1400-Goal plan) | automated |
| Bounded queries | `bounded-reads.test.ts`, `select-all.test.ts` | automated |
| **Screen reader** | — | **not automated; no manual evidence recorded** |

## Defects found by this pass, and fixed

- **Silent truncation at the row cap.** PostgREST caps a response at `max_rows`
  (1000) without saying so. Measured before the fix: a 2500-Note workspace
  rendered 1000 tree rows, and a 1400-Note workspace exported a vault of 1000
  Markdown files. The Notes tree, both export paths, the plan hierarchy, Trash
  and the Note link pickers are now paged, and a guard fails any new unbounded
  read. This is the acceptance criterion "no silent data loss" and it was not
  met before this pass.
- **The pre-paint theme script was blocked by CSP**, so every load flashed the
  wrong theme for anyone with an explicit choice.
- **The assistant was mounted twice**, so collapsing the sidebar discarded an
  in-flight conversation.
- **`text-transform: capitalize` was rewriting Goal titles** the owner had typed.
- **`/preview` rendered inside the authenticated frame**, leaving 102 focusable
  controls behind an overlay.

## Unresolved risks

1. **Nothing is deployed-verified.** Every number above is local. REL-01 and
   REL-02 are open, and `status.md`'s release rule is explicit that local
   implementation is evidence, not a substitute.
2. **MVP-01 is open.** Without the owner's Notion workflow inventory, no test
   count establishes that the product replaces Notion. A passing suite proves
   the product works, not that it is sufficient.
3. **No live AI provider certification.** The outage journeys deliberately run
   with no provider.
4. **No screen-reader evidence.** Manual, and not recorded.
5. **One known flake**: `journey-notes` "a favourite Note stays reachable"
   failed once under parallel load, passed alone and on the next full run.
6. **Remaining unbounded reads** are listed in
   [#238](https://github.com/KalebBefekadu/planner-ai/issues/238) and visible in
   the `bounded-reads` allowlist.
7. **Reference gaps** with no destination yet:
   [#234](https://github.com/KalebBefekadu/planner-ai/issues/234),
   [#235](https://github.com/KalebBefekadu/planner-ai/issues/235),
   [#236](https://github.com/KalebBefekadu/planner-ai/issues/236),
   [#237](https://github.com/KalebBefekadu/planner-ai/issues/237).
8. **An import job caps at 500 pages** (`IMPORT_LIMITS.candidates`), so a Notion
   export larger than that arrives in several imports. Not a defect; it shapes
   what the migration actually looks like and should be said out loud before the
   pilot.

## What QA-01 still needs

- The same suites against the deployed environment, with its SHA and
  configuration recorded (depends on REL-01).
- Manual keyboard and screen-reader evidence.
- The owner's workflow inventory from MVP-01, so "required journeys" names the
  owner's journeys rather than the ones that exist.
