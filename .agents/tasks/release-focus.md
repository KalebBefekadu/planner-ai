# Release Focus And Notes Recovery UI

- Owner: Codex
- Branch: `codex/release-focus`
- Base: `integration/dogfood` at `949b69e`
- Goals:
  - record the owner's decision to remove the Notion pilot from the current program and defer declarative schemas, live tracing/SLO certification, and external MCP certification;
  - extract the Note conflict and recoverable-draft panels from the stateful Notes workspace without changing behavior.
- Writable paths:
  - `docs/roadmap.md`
  - `docs/status.md`
  - `docs/product/requirements.md`
  - `web/src/components/notes-workspace.tsx`
  - `web/src/components/note-recovery-panels.tsx`
  - `.agents/ACTIVE.md`
  - `.agents/tasks/release-focus.md`
  - `.agents/handoffs/release-focus.md`
- Forbidden: production mutation, schema, migrations, Operations, styles, and `/preview`.
- Acceptance: authority documents agree on the revised gates; Notes conflict and draft recovery behavior is preserved; unit, agent, build, and affected browser checks pass.
