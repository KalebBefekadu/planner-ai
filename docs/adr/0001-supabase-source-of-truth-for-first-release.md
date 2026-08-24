---
status: accepted
---

# Supabase is the source of truth for the first release

Planner AI will use Supabase Postgres as the authoritative store for the first legitimate release because reliable authentication, mobile access, synchronization, backup, and recovery are more important than implementing local conflict resolution now. Local Markdown export and data portability remain required, but local-first storage, filesystem sync, and encrypted cloud relay are deferred capabilities rather than launch architecture.

## Consequences

- The separate Agent Native SQL store is not production data and must not become a second source of truth.
- Content capabilities must read and write Planner AI records through the shared operation layer.
- The first release must support complete export so this decision does not trap user data.
- A future local-first mode requires a new architecture decision covering conflict resolution, offline identity, encryption, and migration.
