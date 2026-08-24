---
status: accepted
---

# Use per-user OAuth for MCP and narrow grants for automations

External MCP clients will connect through Agent Native's per-user OAuth flow with read access by default, explicit write grants, optional offline access, revocation, and the same risk policy as chat. Automations use a separate allowlist: they may read and create drafts or proposals by default, reversible writes require an explicit grant, and consequential or external effects wait for human approval.

## Consequences

- Deployment-wide static bearer tokens are not issued as user credentials.
- MCP calls and automation runs carry the Workspace owner identity and are audited by host, scope, Operation, and outcome.
- Interactive agent access never implies unattended automation authority.
