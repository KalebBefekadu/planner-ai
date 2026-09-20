# Authenticated Workspace Context Handoff

## Behavior changed

No product behavior changed. Server-side Supabase authentication and the owner-workspace ID lookup now have one shared, server-only implementation used by root Planner actions, Capture actions, and Action Template actions.

## Files changed

- Added `web/src/lib/supabase/authenticated-context.ts`.
- Removed three duplicate `auth.getUser()` implementations.
- Removed two duplicate owner-workspace ID lookups.
- Kept the richer Planner workspace context local to `app/actions.ts`.
- Added the task contract.

## Checks run

- `npx vitest run`: 94 files, 1,068 tests passed.
- `npm run agent:check`: formatting, ESLint, and TypeScript passed.
- `npm run build`: Next.js 16.3.4 production build passed; 43 static pages generated.
- `git diff --check`: passed.

## Known risks or blockers

- No known blocker.
- No browser or database suite was run because query shapes, Auth APIs, errors, Operations, RLS, and UI behavior are unchanged.
- The Supabase changelog Markdown endpoint could not be rendered by the browsing tool; no new or changed Supabase API was introduced.

## Commit

- Implementation: `4daa0e9` (`refactor: centralize authenticated workspace context`)
