# Planner AI Status

Updated: 2026-09-08

## Current State

Planner AI has a mature, tested application foundation but is not yet production-ready. The immediate goal is a private deployment the owner can use every day instead of Notion for personal notes and planning.

Estimated validated completion:

- **Private dogfood:** about 78 percent.
- **Safe invite beta:** about 55 percent.
- **Long-term Notion, Obsidian, and AI-native vision:** about 27 percent.

Percentages describe evidenced capability, not code volume.

## Verified Foundation

- Authenticated owner-isolated workspaces, canonical relational data, RLS, versioned Operations, Activity, and undo.
- Capture, voice transcription, atomic AI proposals, Today, Vision, Goals, Actions, Calendar, and weekly/monthly/quarterly Review.
- Hierarchical Markdown Notes with autosave, search, backlinks, history, reordering, reparenting, attachments, Trash, export, and loss-aware import/restore.
- Governed assistant behavior, durable Conversations and Memory, AI Exclusion, schema-constrained GenUI, and scoped MCP foundations.
- One Preview-inspired authenticated shell across Workspace and Planner, including responsive navigation and accessible interaction states.
- Production-build browser coverage for canonical desktop and mobile journeys, plus unit, database, type, lint, formatting, build, and dependency-audit gates.

The latest merged delivery work is PR #111 (`82291a9`): Today uses the accepted outcome-focused hierarchy, stays inside Planner navigation, and shows real Goal direction without fixture content.

## Production Evidence

- The production database accepted an independent read-only connection.
- Encrypted backup, checksum, decryption, archive inspection, and isolated local restore passed.
- Production contains 53 public tables with RLS enabled on all 53, two mapped users/workspaces, and 56 registered Operations.
- Hosted migration history is aligned through `20260906114500_recoverable_note_attachment_removal.sql`.
- Vercel built the application successfully, but current protected aliases block anonymous application smoke tests.

See [Production](runbooks/production.md) and [Migration reconciliation](runbooks/migration-reconciliation.md) for operational evidence and procedures.

## Open Delivery Gaps

### Personal dogfood

- Complete and verify the real direction-to-action loop, including deferral and weekly-review continuity.
- Run a representative owner Notion import and reconcile imported, duplicate, and unsupported items.
- Finish authenticated Workspace and Planner parity, then remove superseded `/preview` fixtures.
- Certify embedded-assistant parity for critical Note and Planner Operations, including useful provider-failure behavior.
- Verify one external AI client through narrow authenticated MCP discovery, grants, execution, and revocation.
- Apply pending production migrations during an approved maintenance window and run authenticated deployed smoke tests.
- Complete seven consecutive days of daily use and resolve workflow-blocking defects.

### Release operations

- Apply the three Notes-vault migrations and MCP manual-token repair that remain local-only.
- Verify Vercel production environment, deployment protection, owned domain, SMTP, cron ownership, external alerts, and canonical application mode.
- Establish off-machine backup custody and prove a hosted recovery drill covering Auth, Storage, and managed configuration.

### Later beta gates

- Complete broader live-provider certification, production budgets, and retention review.
- Complete additional OAuth MCP host compatibility and independent security review.
- Add malware scanning before exposing quarantined Note attachments.
- Record manual keyboard/screen-reader, load/SLO, restore, rollback, and incident-drill evidence.

Graph, Canvas, databases, collaboration, plugins, stronger local-first sync, and broad MCP writes remain after personal dogfood and are not current blockers.

## Current Decision

Follow [Roadmap](roadmap.md) with one active ticket at a time. Preserve canonical data and Operations, keep core workflows usable without AI, and treat `/preview` only as a temporary visual reference. Production changes, credentials, billing, and destructive migrations remain explicit approval gates.

## Release Rule

Do not call the product production-ready until persistence, authentication, recovery, provider behavior, security, accessibility, and critical journeys have been observed in the deployed environment. Local implementation is evidence, not a substitute for production verification.
