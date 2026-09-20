# Planner Summary UI Boundary

- Owner: Codex
- Branch: `codex/planner-summary`
- Base: `integration/dogfood` at `6b65e93`
- Goal: extract the read-only period/horizon navigation, planning flow, counters, and drift summary from the stateful Planner workspace.
- Writable paths:
  - `web/src/components/planner-workspace.tsx`
  - `web/src/components/planner-summary.tsx`
  - `.agents/ACTIVE.md`
  - `.agents/tasks/planner-summary.md`
  - `.agents/handoffs/planner-summary.md`
- Forbidden: product behavior, styles, routes, Operations, schema, migrations, and `/preview`.
- Acceptance: the Planner workspace delegates its summary surface through typed props; accessible labels and URL-backed filter behavior remain unchanged; unit, agent, and production-build checks pass.
