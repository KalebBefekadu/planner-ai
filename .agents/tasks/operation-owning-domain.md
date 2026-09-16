# Operation Owning Domain Task

- **Goal:** close EH-04's last bullet by making the owning domain a field on
  the manifest and data in the database, rather than control flow.
- **Owner:** Codex lead
- **Branch:** `codex/operation-owning-domain`
- **Base:** `codex/content-free-telemetry` at `0569c0c`.
- **Writable paths:** `.agents/ACTIVE.md`, this contract, the matching handoff,
  `web/supabase/migrations/20260915230000_operations_name_their_domain.sql`,
  `web/supabase/tests/operation_router.sql`,
  `web/src/lib/operations/index.ts`,
  `web/scripts/generate-operation-registry.mjs`, the generated registry and
  types, and `web/tests/unit/operation-contract-parity.test.ts`.
- **Forbidden paths:** Operation handlers, application routes, production
  configuration/data/credentials, and other worktrees.

## Deliverables

1. `operation_handler_for` holding the routing table as data, with the router
   calling it rather than deciding inline.
2. `operation_contracts.owning_domain`, written by a trigger from that function.
3. `domain` on every manifest entry, with a derived `OperationDomain` type.
4. Parity in both directions, and the drift demonstrated to fail.

## Acceptance

- No Operation reaches a different handler.
- `npm run agent:check`, `npm test`, `npm run verify:db`, `npm run build` and
  the affected browser journeys pass under Node 24.21.0.

## Handoff

`.agents/handoffs/operation-owning-domain.md`
