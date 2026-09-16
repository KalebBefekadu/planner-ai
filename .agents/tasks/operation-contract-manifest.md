# Operation Contract Manifest Task

- **Goal:** begin EH-04 by making TypeScript and Postgres prove they expose the
  same Operation contract, in CI, in both directions.
- **Owner:** Codex lead
- **Branch:** `codex/operation-contract-manifest`
- **Base:** `codex/workspace-module-boundaries` at `ea30d7d`.
- **Dependencies:** `operationDefinitions`, the `operation_contracts` and
  `operation_undo_support` tables, and the existing generated-types drift check.
- **Writable paths:** `.agents/ACTIVE.md`,
  `.agents/tasks/operation-contract-manifest.md`, the matching handoff,
  `web/scripts/generate-operation-registry.mjs`,
  `web/scripts/verify-local-database.sh`,
  `web/src/lib/operations/contract-registry.generated.ts`, and
  `web/tests/unit/operation-contract-parity.test.ts`.
- **Forbidden paths:** the Operation definitions themselves, database
  migrations, application routes, production configuration/data/credentials,
  deployment settings, and other worktrees.

## Why

The contract lives in two hand-maintained places and nothing compares them. A
risk class changed on one side alone would change what the database allows and
what the MCP catalog advertises as destructive, with every test still passing.

## Deliverables

1. A generator that reads the contract rows from a clean reset and writes them
   as a checked-in TypeScript module, following the generated-types precedent.
2. `verify:db` fails when that file is stale; `types:generate` refreshes it.
3. A unit test comparing the manifest to it, needing no database, so drift
   fails the application job as well as the database job.
4. Both failure directions demonstrated, not assumed.

## Acceptance

- No behaviour changes and no new grant. `operation_contracts` and
  `operation_undo_support` stay revoked from every role.
- `npm run agent:check`, `npm test`, `npm run build`, and `npm run verify:db`
  pass under Node 24.21.0.

## Verification

Run from `web/` with Node 24.21.0:

```bash
npm ci
npm run agent:check
npm test
npm run build
npm run verify:db
```

## Handoff

`.agents/handoffs/operation-contract-manifest.md`
