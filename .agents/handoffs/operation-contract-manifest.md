# Operation Contract Manifest Handoff

- **Task:** `.agents/tasks/operation-contract-manifest.md`
- **Branch:** `codex/operation-contract-manifest`
- **Base:** `codex/workspace-module-boundaries` at `ea30d7d`

First slice of EH-04. It closes the third bullet of that outcome and none of the
others; see what is left below.

## Behavior changed

None. This is a check, not a change.

## What it does

The Operation contract has always lived in two places: `operationDefinitions`
in TypeScript, and the `operation_contracts` rows the migrations insert.
**Nothing compared them.** A risk class raised in SQL and not in TypeScript — or
the reverse — would change both what the database allows and what the MCP
catalog advertises as destructive, while every test still passed.

- `web/scripts/generate-operation-registry.mjs` reads `operation_contracts` and
  `operation_undo_support` from a clean reset, via `supabase db dump`, and
  writes `web/src/lib/operations/contract-registry.generated.ts`.
- `verify:db` regenerates it and fails on drift, exactly as it already does for
  the Supabase types. `types:generate` refreshes both.
- `web/tests/unit/operation-contract-parity.test.ts` compares the TypeScript
  manifest to that generated file. It needs no database, so it runs in the
  application CI job.

Drift therefore fails CI in both directions: a stale registry fails the database
job, and a manifest that disagrees with it fails the application job.

PostgREST was the obvious way to read the rows and is the wrong one — both
tables are revoked from `service_role`, which is correct and should stay that
way. `supabase db dump` is first-party, already available in CI, and needs no
grant.

## What the check found

Nothing. All 59 executable Operations agree today on risk class, exposure and
reversibility, and the 52 undo strategies match `undoableOperationIds` exactly.
This slice is preventive, and saying so plainly matters more than finding
something: the value is that the next divergence cannot land quietly.

Two invariants turned out to be stronger than assumed, and are now pinned:

- Every Operation the contract calls reversible has a recorded undo strategy.
  Calling something reversible is a promise; the strategy is how it is kept.
- No irreversible Operation has one, which would tell a person their change
  cannot be taken back while the database stood ready to take it back.

The one legitimate asymmetry is named rather than ignored:
`workspace.snapshot.read.v1` exists in the database and has no TypeScript
handler, because it is an MCP read grant — registered so a token can be scoped
to it and so the read leaves a receipt.

## Negative cases proven

The storage-policy defects on an earlier branch passed a test that asserted a
policy *existed* rather than asking what it decides. So this check was verified
by breaking it, in both directions:

- Manifest drift (`goal.archive.v1` medium → low in TypeScript): two unit tests
  fail, naming the operation, the TypeScript value and the database value.
- Stale registry (the same edit in the generated file): `npm run verify:db`
  prints the diff and exits 1. Clean, it exits 0.

## Files changed

- `.agents/ACTIVE.md`
- `.agents/tasks/operation-contract-manifest.md`
- `.agents/handoffs/operation-contract-manifest.md`
- `web/scripts/generate-operation-registry.mjs` (new)
- `web/scripts/verify-local-database.sh`
- `web/src/lib/operations/contract-registry.generated.ts` (new, generated)
- `web/tests/unit/operation-contract-parity.test.ts` (new)

## Verification

Run in `web/` with Node 24.21.0:

- `npm ci` — passed.
- `npm run agent:check` — passed.
- `npm test` — passed; 85 files, 987 tests, up from 84 and 976.
- `npm run build` — passed.
- `npm run verify:db` — passed; 70 files, 1,280 pgTAP assertions, and
  migrations, types and the Operation contract all consistent.
- Both drift directions deliberately broken and confirmed to fail, as above.

## Risks and follow-up

- The generator parses `supabase db dump` output. The format is stable and the
  parser refuses rather than guesses — it throws if a column is missing, if a
  row's value count disagrees with its column list, or if an array element is
  quoted, which is the shape it has not been taught. A CLI change that alters
  the dump format fails loudly at generation time, not silently at comparison
  time.
- It dumps the whole public schema to read two tables, which is a few seconds
  on a reset database. If that ever matters, narrow it.
- **EH-04 is not closed.** Three bullets remain:
  - Assistant and MCP catalogs are still assembled by hand rather than derived
    from the manifest. This branch proves they agree; it does not make one the
    source of the other.
  - The manifest still does not carry the undo strategy or the owning domain.
    The database holds both. Moving them into TypeScript is what would make one
    typed manifest the single declaration.
  - `dispatch_trusted_operation` is still a rename-and-wrap chain seven
    functions deep — `dispatch_trusted_operation_action_template_base` calling
    `..._notification_base` calling `..._conversation_base` and so on. Every
    stack trace in the database tests walks the whole chain. Replacing it with
    stable domain dispatchers and one explicit router is the large half of
    EH-04 and wants its own contract, because it touches every Operation.
