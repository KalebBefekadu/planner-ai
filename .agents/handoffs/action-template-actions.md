# Action Template Actions Ownership Handoff

## Behavior changed

No product behavior changed. Action Template reads and mutations now live in the Planner-owned `app/planner/templates/actions.ts` server-action module instead of the root `app/actions.ts` module.

## Files changed

- Added `web/src/app/planner/templates/actions.ts` with the Action Template view type and six existing actions.
- Removed those definitions from `web/src/app/actions.ts`.
- Pointed the Planner page and workspace at the owning module.
- Moved the bounded-read allowlist entry to the query's new path.
- Added the task contract.

## Checks run

- `npx vitest run tests/unit/bounded-reads.test.ts`: 1 file, 2 tests passed.
- `npx vitest run`: 94 files, 1,068 tests passed.
- `npm run agent:check`: formatting, ESLint, and TypeScript passed.
- `npm run build`: Next.js 16.3.4 production build passed; 43 static pages generated.
- `git diff --check`: passed.

## Known risks or blockers

- No known blocker.
- The module intentionally preserves the existing assumption that recurring templates remain a hand-sized set; the architecture test continues to document that exception.
- No browser or database suite was run because this is an import/module ownership change with unchanged queries, Operations, and UI behavior.

## Commit

- Implementation: `810a89c` (`refactor: give Action Templates an owning module`)
