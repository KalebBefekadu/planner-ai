# Capture Server-Action Boundary

- Owner: Codex
- Branch: `codex/actions-adapter-audit`
- Base: `integration/dogfood` at `dda881b`

## Goal

Extract the self-contained Capture read/write adapter from the remaining large root Server Actions file without changing behavior.

## Writable paths

- `web/src/app/actions.ts`
- `web/src/app/captures/actions.ts`
- Capture action import sites under `web/src/app` and `web/src/components`
- `.agents/tasks/actions-adapter-audit.md`
- `.agents/handoffs/actions-adapter-audit.md`

## Forbidden paths

- Database migrations, generated types, and Operation contracts
- Capture behavior, validation limits, persistence, and revalidation semantics
- Production configuration and data

## Acceptance criteria

- Capture types and actions have one owning module.
- Planning and Vision callers continue using `app/actions.ts`.
- Existing Capture behavior and public function signatures remain unchanged.
- Standard application checks and the full unit suite pass.

## Verification

- `cd web && npm ci`
- `cd web && npm run agent:check`
- `cd web && npm test`

## Handoff

`.agents/handoffs/actions-adapter-audit.md`
