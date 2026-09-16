# MCP Token Capability Task

- **Goal:** remove `createAdminClient()` from the MCP route by making the manual
  token path prove its caller the way the OAuth path already does.
- **Owner:** Codex lead
- **Branch:** `codex/mcp-actor-capability`
- **Base:** `codex/proposal-worker-capability` at `896b805`.
- **Dependencies:** the EH-01 admin-client register and the MCP token,
  OAuth-grant, and scope-boundary contracts.
- **Writable paths:** `.agents/ACTIVE.md`,
  `.agents/tasks/mcp-token-capability.md`, the matching handoff,
  `docs/engineering/admin-client-boundary.md`,
  `web/supabase/migrations/20260915170000_mcp_token_capability.sql`,
  `web/supabase/tests/mcp_token_scope_boundary.sql`,
  `web/src/app/api/mcp/route.ts`, `web/src/types/supabase.generated.ts`, and
  `web/tests/unit/admin-client-boundary.test.ts`.
- **Forbidden paths:** other application routes, the admin constructor, the
  lifecycle allowlist routes, production configuration/data/credentials,
  deployment settings, and other worktrees.

## Why the admin client is there

The endpoint carries two credentials and treats them very differently.

The **OAuth** path already runs on the caller's own credential.
`execute_mcp_oauth_operation` and `read_mcp_oauth_workspace_snapshot` take a
grant id but prove the caller with `auth.uid()` and the verified `client_id`,
and both are granted to `authenticated`. No admin client is involved.

The **manual token** path took a token **id**. A token id is a database
identifier, not a secret, so possession of one proved nothing and the two
functions could only be granted to `service_role`. That single fact is the whole
reason the route constructed an admin client on every request, including every
OAuth request that never needed it.

`authenticate_mcp_token` already showed the answer: it takes the token hash and
is granted to `anon`.

## Deliverables

1. `read_mcp_workspace_snapshot` and `execute_mcp_operation` take
   `p_token_hash text` and resolve the token themselves, under the same
   not-revoked and not-expired predicate they already used.
2. Both granted to `anon`, revoked from `public` and `authenticated`. The old
   `uuid` signatures are dropped, not left callable.
3. The route uses the publishable-key client it already built for
   authentication, for both credentials.
4. Scope-boundary coverage keeps every existing guard and adds: a token id is no
   longer accepted as a credential, and a signed-in session is not a way in.
5. The MCP route removed from the executable and documented service-role
   migration exceptions.

## Acceptance

- The MCP route does not import or construct the admin client.
- No new `service_role` consumer and no new table grant appears.
- Expiry, revocation and capability scope are still re-decided at execution.
- The admin-boundary test becomes strictly smaller: four exceptions to three.
- `npm run agent:check`, `npm test`, and `npm run verify:db` pass under
  Node 24.21.0.

## Verification

Run from `web/` with Node 24.21.0:

```bash
npm ci
npm run agent:check
npm test
npm run verify:db
```

## Handoff

`.agents/handoffs/mcp-token-capability.md`
