# Adapt Agent Native capabilities without shipping its runtime in v1

Status: Accepted. Supersedes ADR-0002 and ADR-0014 for the first release.

## Decision

Planner AI will adapt the useful Agent Native patterns but will not deploy the imported Chat template or a separate Agent Native runtime in the first release. The Next.js product owns the docked assistant, durable Conversations, persisted Proposals, approvals, explicit Memory, Activity, and inbound MCP. Every AI surface calls the same versioned Planner AI Operations used by the click-first UI.

The `planner` directory remains a read-only integration reference. Its framework database, auth shell, product navigation, plan-node model, extensions, terminal, code execution, secrets, and deployment tools are not production dependencies.

## Evidence

- The imported template is `@agent-native/core` `0.133.3` and contains a complete competing product shell, authentication system, framework database, and chat runtime.
- The template's own source notes that the chat stack is roughly 650–700 KB compressed before Planner AI product code.
- The pinned source supports custom `getSession`, scoped action-route auth, strict embed origins, and framework-owned state, so a future isolated sidecar is technically possible.
- Direct TypeScript validation of the pinned reference succeeds. Its ordinary CLI wrapper attempts a package-manager reinstall and cannot run reproducibly without registry access in the current environment.
- Planner AI already implements the required product capabilities through authenticated Operations, durable Conversations and Proposals, explicit approvals, scoped MCP grants, Activity, and a docked UI without copying domain data or adding a second identity boundary.

## Consequences

- There is one product shell, one authentication boundary, one domain database, and one Conversation/Proposal lifecycle for v1.
- Agent Native developer powers such as shell, source modification, extension installation, deployment, and arbitrary networking remain absent from the user product.
- External MCP connects directly to Planner AI's scoped Streamable HTTP endpoint instead of transiting a sidecar.
- Reconsider a sidecar only when a written capability gap, isolated persistent database, delegated identity, strict origins, rollback, and production dependency review all pass. Any reconsideration requires a new ADR.
