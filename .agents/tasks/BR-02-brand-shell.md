# BR-02: Brand Foundation And Shared Shell

Status: **ready for review**

Owner: Codex

Mode: implementation

Branch: `codex/br-02-brand-shell`

Base: `integration/dogfood`

## Goal

Make the real authenticated product use the Preview design language through one shared frame, one navigation model, and one theme source while preserving every authenticated route.

## Product Decisions

- Preview remains a separate visual reference and fixture environment until migration is complete.
- Shared code may flow into Preview, but production must never import Preview components or fixture data.
- The global rail represents product areas: Home, Planner, Workspace, and Search. Notifications and Settings are footer destinations.
- Planner contextual navigation is grouped into Plan and Align. Workspace contextual navigation owns notes, captures, conversations, activity, and trash until its document tree replaces that list in a later ticket.
- Time horizons are navigation destinations, not goal-type filters. Existing goal filters keep their current semantics in this ticket.
- `planner-theme` on the document root is the only persisted theme contract.

## Writable Paths

- `web/src/app/globals.css`
- `web/src/app/layout.tsx`
- `web/src/components/experience-shell.tsx`
- `web/src/components/theme-toggle.tsx`
- `web/src/lib/experience-navigation.ts`
- `web/tests/unit/experience-navigation.test.ts`
- `web/tests/unit/design-tokens.test.ts`
- `web/tests/e2e/shell-frame.spec.ts`
- visual baselines directly required by the shell test
- this task contract and `.agents/ACTIVE.md`

## Forbidden Paths

- `web/src/app/preview/**`
- Notes and Planner data loaders, Operations, migrations, environment files, lockfiles, and generated files

## Deliverable

1. Canonical typed rail and contextual navigation with explicit main/footer placement and grouped sections.
2. A single authenticated frame using the accepted Preview hierarchy and responsive behavior.
3. One theme storage/event contract and CSP-compatible layout sizing.
4. Global brand tokens sufficient for the shell; no wholesale page redesign in this ticket.
5. Focused unit and browser coverage for navigation, theme, keyboard behavior, responsive layout, and production CSP.

## Acceptance

- All current authenticated destinations remain reachable.
- The active destination is announced with `aria-current`.
- Desktop has one global rail and one contextual sidebar; mobile uses a drawer and compact area navigation.
- Sidebar collapse persists and keyboard focus returns correctly after dialogs close.
- No production module imports from `web/src/app/preview/**`.
- `npm run agent:check` and focused shell tests pass.
- Desktop and mobile screenshots show no overlap in light and dark themes.

## Handoff

Commit the implementation, push the branch, and open a PR to `integration/dogfood`. Record any deferred route or page-level visual work in the PR, not as extra scope here.

## Verification

- `npm run agent:check`
- `npm test` (46 files, 541 tests)
- `NEXT_DIST_DIR=.next-agent npx next build --webpack` (38 routes)
- Authenticated desktop production visual check at `/planner`
- Authenticated mobile development visual checks at `/` and `/planner`
