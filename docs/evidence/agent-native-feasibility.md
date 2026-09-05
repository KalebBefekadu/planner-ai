# Agent Native Feasibility Evidence

## Outcome

**Adapt patterns; defer the runtime.** This closes the PAI-501 adopt/adapt/reject decision for the first release.

## Reviewed Reference

- Reviewed import: Agent Native Planner template, now removed from the active tree and retained in Git history
- Pinned core: `@agent-native/core@0.133.3`
- Direct compiler result: `./node_modules/.bin/tsc --noEmit` passes
- Wrapper result: `pnpm typecheck` attempts a registry-backed reinstall and fails in the restricted environment

## Useful Patterns Adopted

| Agent Native capability | Planner AI implementation                                                |
| ----------------------- | ------------------------------------------------------------------------ |
| Shared action contract  | Versioned Operation registry in `web/src/lib/operations`                 |
| Agent tool parity       | Assistant proposals and MCP tools are generated from the same registry   |
| Explicit approvals      | Persisted `ai_proposals`; approval sends only the Proposal ID            |
| Durable chat            | `conversations` and `conversation_messages` in canonical Supabase        |
| Context control         | Owner-scoped minimal context with per-Note AI Exclusion                  |
| MCP                     | Scoped, revocable Streamable HTTP endpoint with MFA-gated token issuance |
| Auditability            | Transactional Operation receipts and user-visible Activity               |
| Failure isolation       | Click-first workspace and offline Capture remain usable without AI       |

## Rejected Production Surface

The imported auth shell, navigation, plan-node SQL model, local SQLite domain state, framework settings UI, code execution, terminal, generated extensions, repository tools, deployment tools, arbitrary outbound MCP, and secret-management capabilities are outside the production boundary.

## Revisit Gate

A future runtime spike must prove a capability that cannot be delivered safely in `web`, use a separate managed database, accept only short-lived stable-ID delegation, expose only Planner AI Operations, pass origin/replay/revocation/cross-Workspace tests, and add less operational risk than the capability is worth.

## Cleanup Result

The imported application was removed from the active repository after this evidence and ADR-0024 captured the decision. This eliminates a second application, dependency graph, auth shell, schema, and design system without removing any Planner AI production capability.
