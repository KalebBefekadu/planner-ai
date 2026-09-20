# Authenticated Workspace Context

- Owner: Codex
- Branch: `codex/authenticated-workspace-context`
- Base: `integration/dogfood` at `c92c3f5`
- Goal: centralize the identical server-side Supabase user check and owner-workspace ID lookup used by root Planner actions, Capture actions, and Action Template actions.
- Writable paths:
  - `web/src/lib/supabase/authenticated-context.ts`
  - `web/src/app/actions.ts`
  - `web/src/app/captures/actions.ts`
  - `web/src/app/planner/templates/actions.ts`
  - `.agents/tasks/authenticated-workspace-context.md`
  - `.agents/handoffs/authenticated-workspace-context.md`
- Forbidden: schema, RLS, migrations, Operations, public APIs, client code, production configuration, and unrelated behavior.
- Acceptance:
  - one shared helper owns the existing `auth.getUser()` authentication contract;
  - one shared helper owns the existing owner-workspace ID lookup;
  - the richer Planner workspace lookup remains local to its feature;
  - error messages and return behavior remain unchanged;
  - unit tests, `agent:check`, and production build pass.
