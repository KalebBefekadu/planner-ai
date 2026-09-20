# Vision Server-Action Boundary

- Owner: Codex
- Branch: `codex/vision-actions`
- Base: `integration/dogfood` at `2386cc8`
- Goal: move Vision reads and writes out of the root planning action module into the Vision route's owning module without changing behavior.
- Writable paths:
  - `web/src/app/actions.ts`
  - `web/src/app/vision/actions.ts`
  - `web/src/app/vision/page.tsx`
  - `web/src/app/onboarding/page.tsx`
  - `web/src/components/vision-ui.tsx`
  - `.agents/ACTIVE.md`
  - `.agents/tasks/vision-actions.md`
  - `.agents/handoffs/vision-actions.md`
- Forbidden: schema, migrations, Operations, product behavior, and `/preview`.
- Acceptance: all Vision callers use the owning module; root actions retain only planning/goal responsibilities; unit, agent, and production-build checks pass.
