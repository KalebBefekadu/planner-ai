---
status: accepted
---

# Stage agent extensibility behind security gates

Production code execution is disabled. The first release does not expose arbitrary generated extensions, executable skills, shell/filesystem tools, source editing, or arbitrary outbound MCP configuration. Reviewed prompt-only skills and typed assistant settings may be shipped as product capabilities.

Outbound MCP begins only after invite beta with approved remote HTTP servers, OAuth, narrow scopes, revocation, and per-connection allowlists. All imported, retrieved, attached, or external material is untrusted data rather than an instruction source. Connection secrets remain encrypted server-side, domain-bound, and invisible to models and browsers.

## Consequences

- Agent Native developer capabilities do not automatically become Planner AI user capabilities.
- Inbound Planner AI MCP and outbound third-party MCP have separate grants, risk reviews, and release gates.
- Prompt-injection, confused-deputy, destination-change, and secret-exfiltration fixtures are mandatory before external tools or extensions launch.
- Sandboxed extensions require a later explicit decision even if the underlying framework supports them.
