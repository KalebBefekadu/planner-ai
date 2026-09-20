# Capture Server-Action Boundary Handoff

## Behavior changed

- No product behavior changed.
- Capture reads, writes, offline retry responses, validation, and `CaptureView` now live in `app/captures/actions.ts`.
- Pages and client components import Capture capabilities from their owning module.
- The root `app/actions.ts` remains responsible for Vision and Planning and shrank from 992 to 857 lines.

## Files changed

- `web/src/app/captures/actions.ts`
- `web/src/app/actions.ts`
- `web/src/app/page.tsx`
- `web/src/app/inbox/page.tsx`
- `web/src/app/search/page.tsx`
- `web/src/components/dump-ui.tsx`
- `web/src/components/shell-quick-capture.tsx`
- `web/src/components/capture-proposal-queue.tsx`
- `.agents/tasks/actions-adapter-audit.md`
- `.agents/handoffs/actions-adapter-audit.md`

## Checks run

- Node 24.21.0: `npm ci` — passed; 781 packages installed.
- Full unit suite — 94 files, 1,068 tests passed.
- `npm run agent:check` — formatting, lint, and typecheck passed.
- `npm run build` — Next.js 16.3.4 production build passed and generated all 43 static pages.
- `git diff --check` — passed.

## Risks and blockers

- The module preserves both canonical and legacy Capture paths. Removing the legacy path is a separate data-model decision.
- No database contract changed, so database and browser suites were not required for this mechanical extraction.

## Commit

Recorded in the commit that adds this handoff.
