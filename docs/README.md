# Planner AI Documentation

This directory is the product and engineering source of truth. Read only the documents needed for the decision at hand.

## Start Here

1. [Vision](product/vision.md) - the product promise, release boundary, and long-term direction.
2. [Glossary](../CONTEXT.md) - canonical domain language.
3. [Requirements](product/requirements.md) - first-release behavior and quality requirements.
4. [Experience](product/experience.md) - information architecture, interaction rules, and visual direction.
5. [Architecture](engineering/architecture.md) - current system boundaries and staged evolution.
6. [Data model](engineering/data-model.md) - canonical entities and invariants.
7. [Roadmap](roadmap.md) - ordered milestones and exit gates.
8. [Status](status.md) - current evidence, gaps, and immediate work.

## Specialized References

- [AI architecture](engineering/ai.md)
- [AI provider register](engineering/ai-providers.md)
- [Architecture decisions](adr/README.md)
- [Production runbook](runbooks/production.md)
- [MCP setup and recovery](runbooks/mcp.md)
- [Migration reconciliation](runbooks/migration-reconciliation.md)
- [Engineering evidence](evidence/)

## Authority

When documents disagree, use this order:

1. accepted ADRs and the glossary;
2. requirements and architecture;
3. roadmap and status;
4. evidence and research.

Code describes current behavior, not necessarily intended behavior. A conflict between code and an authority document is migration work and must be made explicit in [status](status.md).

## Maintenance Rules

- Keep current facts in `status.md`, not scattered through strategy documents.
- Keep delivery order in `roadmap.md`; do not maintain a second ticket backlog.
- Add an ADR only for a consequential, hard-to-reverse trade-off.
- Keep research as evidence, not product authority.
- Update links and status in the same change as a behavior or architecture change.
- Never place credentials, production data, private content, or raw provider output in documentation.
