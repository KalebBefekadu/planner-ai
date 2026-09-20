# Vision Server-Action Boundary Handoff

## Behavior changed

No product behavior changed. Vision loading, validation, canonical Operation dispatch, legacy persistence, and revalidation now live in `app/vision/actions.ts`. Vision, onboarding, and the Vision editor import that owning module directly; the root action module consumes only the Vision read needed to build the planning hierarchy.

## Files changed

- `web/src/app/vision/actions.ts`
- `web/src/app/actions.ts`
- `web/src/app/vision/page.tsx`
- `web/src/app/onboarding/page.tsx`
- `web/src/components/vision-ui.tsx`
- `.agents/ACTIVE.md`, task, and this handoff

## Checks run

- `npm run agent:check` — format, lint, and typecheck passed.
- `npx vitest run` — 94 files and 1,068 tests passed.
- `npm run build` — Next.js production build passed and generated all 43 routes.
- `git diff --check` — passed.

## Risks and blockers

- Both canonical and legacy data paths were moved intact; no schema, RLS, or Operation changed.
- `src/app/actions.ts` is now focused on the coupled Goal/Action planning hierarchy. Its remaining size alone does not justify another split.

## Commit

`247f04a`
