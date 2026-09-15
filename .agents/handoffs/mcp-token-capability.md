# MCP Token Capability Handoff

- **Task:** `.agents/tasks/mcp-token-capability.md`
- **Branch:** `codex/mcp-actor-capability`
- **Base:** `codex/proposal-worker-capability` at `896b805`

## Behavior changed

- `/api/mcp` no longer constructs the Supabase admin client. Both credentials
  now execute on the client they were verified with: the OAuth path on the
  person's JWT, as before, and the manual path on the publishable-key client
  that already performed `authenticate_mcp_token`.
- `read_mcp_workspace_snapshot` and `execute_mcp_operation` take the token hash
  instead of the token id, resolve the token under the same not-revoked and
  not-expired predicate, and are granted to `anon`. The `uuid` signatures are
  dropped, not left callable.
- Expiry, revocation, capability scope, the actor substitution around
  `dispatch_trusted_operation`, the `mcp` surface attribution, the per-minute
  usage window, and every response code are unchanged.
- The executable admin-client inventory is strictly smaller: four lifecycle
  consumers and three ordinary-route exceptions, down from four.

## What this actually fixes

The endpoint carried two credentials and proved only one of them.

`execute_mcp_oauth_operation` takes a grant id, but a grant id is not the
credential: the function proves the caller with `auth.uid()` and the verified
`client_id` before trusting the grant. It is granted to `authenticated` and has
never needed admin access.

`execute_mcp_operation` took a token id and proved nothing. It checked that the
token existed, was unrevoked, unexpired and scoped — all properties of the
token, none of them properties of the caller. Anyone able to call the function
while naming a live token id could act as its owner, which is why the function
could only be granted to `service_role`, and why the route held table-wide admin
access on every request including the OAuth ones.

The token hash is the only value derivable from the token itself, which is why
`authenticate_mcp_token` already used it and was already granted to `anon`. The
two execution functions now match. The manual path is structurally equal to the
OAuth path: present the credential or get nothing.

## Files changed

- `.agents/ACTIVE.md`
- `.agents/tasks/mcp-token-capability.md`
- `.agents/handoffs/mcp-token-capability.md`
- `docs/engineering/admin-client-boundary.md`
- `web/supabase/migrations/20260915170000_mcp_token_capability.sql`
- `web/supabase/tests/mcp_token_scope_boundary.sql`
- `web/src/app/api/mcp/route.ts`
- `web/src/types/supabase.generated.ts`
- `web/tests/unit/admin-client-boundary.test.ts`

## Verification

Run in `web/` with Node 24.21.0, holding the repository-wide Supabase lock:

- `npm ci` — passed; 770 packages, 0 vulnerabilities.
- `npm run agent:check` — passed; Prettier, ESLint, and TypeScript clean.
- `npm test` — passed; 81 files, 927 tests.
- `npm run test:db` — passed; 69 files, 1,234 assertions.
- `npm run types:generate` then `npm run verify:db` — passed; migrations, pgTAP,
  and generated types agree after a clean reset.

## Risks and follow-up

- The scope-boundary suite exercises the functions directly rather than over
  HTTP, which is deliberate — an authorization boundary that only holds when the
  caller cooperates is not a boundary. No test drives a real MCP client end to
  end, so the transport wiring is unchanged but unproven by this branch.
- The token hash is now a bearer credential in its own right at the database
  boundary. It always was in effect, since `authenticate_mcp_token` accepted it
  from `anon`; this makes the property explicit across all three functions.
  Anything that logs RPC arguments would log a credential, so telemetry work
  under EH-06 must exclude these parameters.
- Three ordinary routes still use the admin client: Note attachments, Note
  export, and signup invite actions. Per the removal order the next slice is
  attachment reserve/finalize/reconcile with the export read alongside it.
