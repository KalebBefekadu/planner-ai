---
status: accepted
---

# Route AI work by capability instead of vendor

Planner AI will define provider-independent roles for agent reasoning, structured analysis, transcription, and embedding/search. Each role ships with one evaluated default, and the agent-critical path has a tested fallback; exact models are selected through evaluation fixtures rather than embedded throughout product code.

## Consequences

- Provider SDKs stay behind role-specific adapters.
- Prompts, structured schemas, cost limits, timeouts, and evaluations are versioned per role.
- Adding a provider does not make it selectable until it passes the relevant quality and safety fixtures.
