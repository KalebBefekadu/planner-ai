# Operation Owning Domain Handoff

- **Task:** `.agents/tasks/operation-owning-domain.md`
- **Branch:** `codex/operation-owning-domain`
- **Base:** `codex/content-free-telemetry` at `0569c0c`

**This closes EH-04.**

## A correction first

Two of my earlier statements about EH-04 were wrong, and both are in handoffs
and pull requests already open.

1. I recorded "derive assistant and MCP catalogs from that manifest" as
   outstanding. **It was already done** before this program began:
   `src/lib/mcp/catalog.ts` builds `mcpOperationIds` by filtering
   `operationDefinitions` on exposure, and `src/lib/assistant/policy.ts` builds
   its chat catalog the same way. I repeated the roadmap's wording without
   checking whether the code already satisfied it.
2. I wrote that the manifest "does not carry the undo strategy or the owning
   domain". The roadmap asks for "Operation ID, major version, schemas, risk,
   exposure, reversibility, and owning domain" — undo strategy is not on that
   list. I added it.

So EH-04 had exactly one bullet left: **owning domain**. That is what this does.

## What changes

The owning domain existed only as control flow. The router's ladder decided it
and immediately spent it on a function call, so nothing could ask which domain
owns an Operation without dispatching one.

- `public.operation_handler_for(operation_id)` — an immutable function holding
  the routing table as data. The router calls it, then dispatches on the
  returned name, so the ordering subtlety lives in one place that can be asked
  directly: `note.appearance.v1` before `note.%`,
  `review.complete-period.v1` before `review.%`. Previously the only way to
  check that was to dispatch and see where you landed. Now it is a `select`.
- `operation_contracts.owning_domain` — the same answer as a column, written by
  a trigger using that function, so it cannot disagree with the router.
- `domain` on all 59 entries of `operationDefinitions`, and an
  `OperationDomain` type derived from them.
- The generated registry carries it, and the parity test compares the two.

The router keeps a second ladder, but it is a flat name-to-function mapping
with no ordering to get wrong.

## Why a column and not a generated column

A stored generated column would be the obvious way to keep it correct. It does
not work here: `pg_dump --data-only` omits generated columns, and that dump is
exactly what the registry generator reads. So it is an ordinary column with a
trigger, and pgTAP asserts the column equals the function for every row.

## Files changed

- `.agents/ACTIVE.md`, the task and this handoff
- `web/supabase/migrations/20260915230000_operations_name_their_domain.sql`
- `web/supabase/tests/operation_router.sql`
- `web/src/lib/operations/index.ts`
- `web/scripts/generate-operation-registry.mjs`
- `web/src/lib/operations/contract-registry.generated.ts`
- `web/src/types/supabase.generated.ts`
- `web/tests/unit/operation-contract-parity.test.ts`

## Verification

Run in `web/` with Node 24.21.0:

- `npm run agent:check` — passed.
- `npm test` — passed; 88 files, 1,015 tests, up from 1,013.
- `npm run test:db` — passed; 73 files, 1,335 assertions, up from 1,326.
- `npm run verify:db` — passed.
- `npm run build` — passed.
- `npx playwright test` across notes, planner, today, review and capture —
  77 passed, every one dispatching through the rewritten router.
- Domain drift deliberately planted (`note.appearance.v1` marked `note` in
  TypeScript) and confirmed to fail, naming the Operation and both values.

## Risks and follow-up

- The routing table now exists twice in the migration: once as data in
  `operation_handler_for`, once as the name-to-function ladder in the router.
  The second cannot get the *order* wrong, which was the dangerous half, but a
  domain added to the first without a branch in the second would fall through
  to the planner handler. The pgTAP file pins each domain it knows; a new one
  needs a case there too.
- `major version` is the one manifest field still implicit: it lives in the id
  suffix (`.v1`) rather than as a field. Every consumer parses the id today and
  nothing has needed it separately, so this is noted rather than changed.
