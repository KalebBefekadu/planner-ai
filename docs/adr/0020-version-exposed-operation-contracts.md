---
status: accepted
---

# Version exposed Operation contracts

Every exposed Planner AI Operation has a stable semantic identifier, versioned input and output schemas, risk metadata, and a machine-readable capability description shared by UI, chat, automation, and MCP surfaces. Compatible additions remain within the current major version; breaking changes ship as a new major version beside the old one.

## Consequences

- Contract and parity tests run across every enabled surface.
- Private-beta deprecations require notice and a documented migration.
- After public launch, deprecated external versions remain available for at least 90 days unless a security issue requires faster removal.
- New feature exposure is gated until authorization, risk, audit, and compatibility behavior pass.
