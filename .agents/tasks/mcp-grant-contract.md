# MCP Grant Contract Task

- **Goal:** refuse an MCP grant that names an Operation the contract does not
  expose to MCP, at creation rather than at use.
- **Owner:** Codex lead
- **Branch:** `codex/mcp-grant-contract`
- **Base:** `codex/operation-dispatch-router` at `5cbf983`.
- **Writable paths:** `.agents/ACTIVE.md`, this contract, the matching handoff,
  `web/supabase/migrations/20260915210000_mcp_grants_follow_the_contract.sql`,
  and `web/supabase/tests/mcp_grant_contract.sql`.
- **Forbidden paths:** application code, the router, other migrations,
  production configuration/data/credentials, and other worktrees.

## Deliverables

1. A `security definer` trigger on both grant tables, firing on insert and on
   update of `allowed_operations`.
2. An error that names the offending ids.
3. pgTAP for the accepted case, a ui-only Operation, a non-Operation, one bad
   entry among good ones, and widening an existing grant.

## Acceptance

- Existing rows are not validated or rewritten.
- The existing MCP suites pass untouched.
- `npm run agent:check`, `npm test`, `npm run verify:db` and the MCP browser
  tests pass under Node 24.21.0.

## Handoff

`.agents/handoffs/mcp-grant-contract.md`
