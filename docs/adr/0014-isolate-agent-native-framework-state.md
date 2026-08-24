---
status: accepted
---

# Isolate the Agent Native runtime and framework state

Status: Superseded for v1 by ADR-0024. These isolation requirements remain mandatory if a later runtime is reconsidered.

The Next.js product will deploy on Vercel and Planner AI domain data will remain in its production Supabase project. A minimal Agent Native runtime will deploy separately and use its own persistent managed Postgres database for chat, resources, settings, approvals, sessions, and other framework-owned state. The sidecar is embedded into `web` through strict-origin communication and short-lived, server-verified identity delegation based on the stable Supabase user ID.

## Consequences

- Agent Native changes domain data only through authenticated Planner AI Operations.
- Framework tables never duplicate or directly own Goals, Actions, Notes, Captures, or Memory.
- The agent runtime and database can be deployed, migrated, backed up, and rolled back without changing Planner AI domain tables.
- The integration spike must prove identity delegation, origin checks, Operation transport, revocation, and failure behavior before production use.
