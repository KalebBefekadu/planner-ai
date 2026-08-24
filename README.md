# Planner AI

Planner AI is a private, voice-first planning and knowledge workspace with a full click-first interface, a docked AI assistant, and a deliberately scoped MCP surface.

## Repository Authority

| Path | Status | Purpose |
| --- | --- | --- |
| `web/` | Product application | The only user-facing product shell to carry forward. |
| `planner/` | Integration reference | Imported Agent Native prototype. Do not add product data or product UI here. |
| `database/schema.sql` | Legacy reference | One-shot MVP schema. Do not apply to a new or production database. |
| `database_schema.md` | Approved design | Canonical relational model to implement through migrations. |
| `docs/adr/` | Approved decisions | Architectural decisions that constrain implementation. |

Planner AI adapts Agent Native's useful patterns without shipping its runtime in the first release. The docked assistant, durable proposals, approvals, Activity, and MCP endpoint live inside `web` and call the same versioned Operations as the click-first UI. The decision and evidence are recorded in [ADR-0024](docs/adr/0024-adapt-agent-native-capabilities-without-shipping-its-runtime.md).

## Canonical Documents

Read these in order before implementation:

1. [Product vision](vision.md)
2. [Product requirements](product_requirements.md)
3. [Product direction](planner_ai_product_direction.md)
4. [Glossary](CONTEXT.md)
5. [Target architecture](architecture.md)
6. [Canonical data model](database_schema.md)
7. [Intelligence architecture](ai_integration.md)
8. [Experience guidelines](ui_ux_guidelines.md)
9. [Decision register](planner_ai_decision_register.md)
10. [Implementation roadmap](planner_ai_implementation_roadmap.md)
11. [Current-state audit](docs/current-state-audit.md)
12. [Production runbook](docs/production-runbook.md)
13. [MCP setup and recovery](docs/mcp-setup-and-recovery.md)

When prose conflicts, accepted ADRs and the decision register win. When code conflicts with the documents, treat the code as current state to migrate, not the intended design.

## Local Applications

The product app lives in `web`:

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). See [web/README.md](web/README.md) for configuration and verification.

The `planner` app is retained as read-only implementation reference. It is not a deployment target and must not receive Planner AI product data or features.

## Implementation Status

The application, canonical migrations, CI, secure AI routes, daily execution, editable planning, Weekly/Monthly/Quarterly Review, Notes vault, onboarding/privacy controls, evidence-linked assistant, Activity, recoverable Trash, export, cancellable deletion, PWA Capture queue, and scoped OAuth/manual MCP endpoint are implemented locally. Remote Supabase migration, private attachment infrastructure, provider configuration, authenticated production journeys, and recovery drills remain open. See the [implementation status](docs/implementation-status.md) for verified evidence and blockers, then use the [implementation roadmap](planner_ai_implementation_roadmap.md) for ticket acceptance criteria.
