---
status: accepted
---

# Use risk-based approvals for agent Operations

Planner AI will classify every Operation as immediate, reversible, consequential, or prohibited. Reads and analysis run immediately; low-risk reversible writes execute with a visible undo path; destructive, bulk, external, or difficult-to-reverse Operations require a preview and explicit confirmation; prohibited production capabilities cannot run.

## Consequences

- Risk class is mandatory metadata on every shared Operation.
- Reversible writes must define and test an undo strategy before the agent can execute them without confirmation.
- Confirmation previews must identify the exact records and external effects involved.
- MCP and automation calls follow the same or stricter approval policy as in-app chat.
