---
status: accepted
---

# Govern AI providers and use managed credentials

Production uses only paid API or enterprise AI paths whose current terms do not train on customer inputs or outputs by default and whose retention behavior is documented. A provider register records purpose, data categories, region, retention, subprocessors, deletion limitations, and approved features. Personal content is never routed through consumer chat accounts or unsuitable free API tiers, and Planner AI does not train on it without separate explicit opt-in.

Dogfooding and invite beta use Planner AI-managed server credentials. Each Workspace receives visible usage, a soft monthly budget, per-Operation token and tool-call limits, rate limits, and a hard platform spending cap. Bring-your-own-key support is deferred.

## Consequences

- Provider approval is a privacy and release process, not only an adapter implementation.
- Minimum context and reduced-retention modes are used when compatible with the required capability.
- Ordinary work routes to the least expensive evaluated model; unusually expensive analysis requires an explicit user choice.
- User-supplied provider-secret storage and support are absent from the first beta.
