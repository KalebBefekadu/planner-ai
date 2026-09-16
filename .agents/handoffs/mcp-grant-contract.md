# MCP Grant Contract Handoff

- **Task:** `.agents/tasks/mcp-grant-contract.md`
- **Branch:** `codex/mcp-grant-contract`
- **Base:** `codex/operation-dispatch-router` at `5cbf983`

The follow-up named in the router handoff. Small, and it finishes that finding.

## Behavior changed

An MCP grant can no longer name an Operation the contract does not expose to
MCP, or an id that is not an Operation at all. Both grant tables are covered,
on insert and on update.

`allowed_operations` was constrained only by `cardinality(...) <= 50`. Nothing
in the database required a granted id to be real, let alone mcp-exposed. The
catalog that builds the list a person picks from does filter on exposure, but in
TypeScript, so the rule held only for callers who went through it.

The router refuses such a grant when it is **used**. This refuses it when it is
**made**, which is where a person can still be told which entry to remove.

## Why a trigger, and the trap in it

A check constraint cannot see another table, so this is a `before insert or
update of allowed_operations` trigger on each grant table.

It is `security definer` because **`operation_contracts` forces row level
security**. Evaluated as the caller, the lookup would find nothing, every entry
would look unexposed, and every grant would be rejected — failing closed, but
completely. That is the same fault that silently denied every attachment upload
two branches earlier, so the migration says so in a comment rather than leaving
it to be rediscovered.

## Existing rows are left alone, deliberately

The trigger fires on write. A grant made before this rule keeps its row and
simply stops working, because the router already refuses it. Validating history
here would fail the migration on any database holding such a row, which is a
worse outcome than a grant that no longer functions.

## Files changed

- `.agents/ACTIVE.md`, the task and this handoff
- `web/supabase/migrations/20260915210000_mcp_grants_follow_the_contract.sql`
- `web/supabase/tests/mcp_grant_contract.sql` (new)

Generated types are unchanged: a function returning `trigger` is not an RPC.

## Verification

Run in `web/` with Node 24.21.0:

- `npm run agent:check` — passed.
- `npm test` — passed; 87 files, 1,006 tests, unchanged.
- `npm run test:db` — passed; 72 files, 1,308 assertions, up from 71 and 1,299.
  The existing MCP token and scope-boundary suites pass untouched, which is what
  says the trigger does not refuse legitimate grants.
- `npm run verify:db` — passed.
- `npx playwright test mcp-token-lifecycle, journey-assistant --project=chromium`
  — 6 passed, including real token creation, scoping and revocation through the
  settings UI.

## Risks and follow-up

- The rule is evaluated at write time against the contract as it stands then. If
  an Operation's exposures later drop `mcp`, existing grants naming it are not
  revisited — they simply stop working at dispatch. Making exposure changes
  sweep existing grants would need a trigger on `operation_contracts` too, and
  is only worth it once exposures actually change in practice.
- The error names the offending ids in `detail`. They are the person's own
  input rather than workspace content, so this leaks nothing, but anything that
  forwards `detail` into telemetry should still be checked against EH-06's
  content-free rule when that lands.
