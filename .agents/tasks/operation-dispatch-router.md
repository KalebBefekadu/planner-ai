# Operation Dispatch Router Task

- **Goal:** replace the seven-function `dispatch_trusted_operation` chain with
  one router, with the surface and exposure checks in front of it.
- **Owner:** Codex lead
- **Branch:** `codex/operation-dispatch-router`
- **Base:** `codex/remove-preview` at `906cc55`.
- **Writable paths:** `.agents/ACTIVE.md`, this contract, the matching handoff,
  `web/supabase/migrations/20260915200000_one_operation_router.sql`,
  `web/supabase/tests/operation_router.sql`, and
  `web/src/types/supabase.generated.ts`.
- **Forbidden paths:** every Operation handler, application code, production
  configuration/data/credentials, deployment settings, and other worktrees.

## Why

The chain is not merely deep. The surface validation and the
`operation_contracts` exposure check sit in its last function, so the six
families matched by the wrappers in front of it are never checked against the
contract at all.

## Deliverables

1. One `dispatch_trusted_operation` performing both checks before routing.
2. The routing table flattened in the order the chain produced, so no Operation
   changes handler.
3. The six `_base` functions dropped.
4. pgTAP covering both checks for every previously-skipped family, and the four
   ordering cases where a specific id must precede its family.

## Acceptance

- No Operation reaches a different handler.
- Every pre-existing pgTAP assertion still passes.
- `npm run agent:check`, `npm test`, `npm run verify:db` and the affected
  browser journeys pass under Node 24.21.0.

## Handoff

`.agents/handoffs/operation-dispatch-router.md`
