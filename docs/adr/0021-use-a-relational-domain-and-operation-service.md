---
status: accepted
---

# Use a relational domain and one Operation service

Planner AI will model its domain with explicit Workspace-scoped relational entities, including Vision, Goal, Action, Planning Horizon, Capture, Proposal, Note, Review, and Memory. It will not promote either prototype representation: separate tables per planning horizon or an unrestricted generic node tree.

Every durable write crosses one transport-neutral Operation service. The service owns typed validation, actor and Workspace context, authorization, idempotency, concurrency, transaction handling, audit metadata, and stable errors. UI Server Actions, internal HTTP, Agent Native, MCP, and automations are adapters around the same implementation.

## Consequences

- All domain rows carry `workspace_id`; composite relationships enforce that linked records belong to the same Workspace.
- Browser code cannot write domain tables directly, even though RLS still protects every exposed table.
- Multi-record changes such as applying a Proposal, moving a subtree to Trash, or completing a Review are transactional.
- The legacy horizon tables and Agent Native plan-node tables require explicit migration or retirement rather than reuse.
