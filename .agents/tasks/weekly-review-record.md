# Completed Weekly Review Record

- Owner: Codex
- Branch: `codex/weekly-review-record`
- Base: `integration/dogfood` at `7f5387d`
- Goal: show a completed current-week Review as a saved record instead of reopening the editable completion form.
- Writable paths:
  - `web/src/app/review/actions.ts`
  - `web/src/components/weekly-review.tsx`
  - `web/tests/e2e/journey-review.spec.ts`
  - `.agents/ACTIVE.md`
  - `.agents/tasks/weekly-review-record.md`
  - `.agents/handoffs/weekly-review-record.md`
- Forbidden: schema, migrations, Review Operations, monthly/quarterly behavior, and unrelated Planner UI.
- Acceptance:
  - the current weekly period loads its completed Review by planning-horizon start;
  - a completed week renders its reflection and completion date as read-only evidence;
  - the editable form and completion button are absent for a completed week;
  - the existing Review journey verifies the saved-record state after navigation;
  - unit, agent, build, and affected browser checks pass.
