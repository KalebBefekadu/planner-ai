# Planner AI Status

Updated: 2026-09-05

## Executive Assessment

Planner AI has a substantial, well-tested application foundation, but it is not a finished product or production-ready beta. The canonical production schema, RLS, versioned Operations, AI safety boundaries, recovery-aware workflows, and broad automated tests are now in place. The largest remaining gap is product depth: the authenticated shell has begun converging with `/preview`, but several long-term knowledge, collaboration, and agent capabilities remain staged rather than complete.

Estimated completion:

- **Private dogfood product:** about 70 percent.
- **Safe invite beta:** about 50 percent.
- **Full long-term Notion/Obsidian/AI-native vision:** about 25 percent.

These percentages describe validated capability, not code volume.

## Verified Locally

Fresh checks on 2026-09-05:

- ESLint passes.
- TypeScript passes with no emitted output.
- Prettier passes for source and tests.
- Next.js production build passes and generates 38 routes, including canonical `/planner` and compatibility redirect `/goals`.
- Vitest passes: 37 files, 372 tests.
- pgTAP passes: 45 files, 895 assertions.
- The local Supabase reset/migration chain and database advisors passed in the preceding full verification.
- The canonical authenticated Playwright corpus passes 50 desktop and mobile tests after the cleanup and route convergence work.
- The dependency audit reports no known vulnerabilities at the configured high-severity threshold.

Implemented local capability includes verified authentication boundaries, canonical relational migrations, owner-isolating RLS, versioned Operation dispatch, Activity and undo, Today, Vision/Goals/Actions, Planner calendar, Capture and voice transcription routes, atomic Proposals, Weekly/Monthly/Quarterly Review, Notes and Markdown contracts, exact search, onboarding, settings, notifications, Conversations, explicit Memory, AI Exclusion, Trash, export, cancellable account deletion, PWA Capture recovery, assistant evidence/safety controls, GenUI schema validation, and scoped MCP endpoints.

## Production Evidence

- The configured production Session Pooler accepted an independent read-only query.
- A production logical backup was encrypted, checksummed, decrypted, and accepted by `pg_restore --list`.
- The same archive restored successfully into a disposable local Supabase Postgres 17 instance; 8 public tables, all 8 RLS-enabled, and 5 public functions were verified before the instance and plaintext archive were destroyed.
- Read-only catalog inspection found two remote-only migration-history entries whose effects match reviewed local hardening migrations.
- The two duplicate remote migration entries were reconciled to the reviewed local versions.
- The complete canonical migration sequence was applied successfully and the guarded preflight now passes.
- Count-only production verification found 53 public tables, all 53 RLS-enabled, two Auth users mapped to two Workspaces, no unmigrated users, and 56 registered Operations.
- [Migration reconciliation](runbooks/migration-reconciliation.md) records the completed procedure and evidence.

Legacy tables remain available for rollback while the deployed application is switched to canonical mode.

## Critical Gaps

### Product convergence

- `/preview` remains a design laboratory, but its rail, contextual sidebar, command palette, restrained visual system, and responsive navigation are now used by the authenticated shell.
- Planner now adds real-data horizon filtering, progress summaries, and a stronger direction-to-action hierarchy; Notes adds clearer document metadata and serialized autosave for rapid edits.
- Legacy/canonical mode branches remain until the deployed canonical release is verified and the rollback window closes.
- Several north-star screens are illustrative rather than connected to real Operations.
- Notes are a credible foundation but not yet the polished editor, backlinks, attachments, graph, canvas, or database system in the long-term vision.

### Production data and operations

- Canonical schema cutover is complete; the Vercel application switch and deployed smoke test are in progress.
- Database backup integrity and local isolated restoration are proven; off-machine custody and a hosted recovery-project drill covering Auth, Storage, and managed configuration remain unverified.
- Remote migration history must be reconciled before any push.
- Vercel production environment values, latest deployment, custom SMTP/domain, monitoring, alerts, cron ownership, and authenticated production journeys are not fully re-verified.

### AI and external agents

- Deterministic AI tests pass, but the last full live-provider corpus encountered provider rate limits; fallback certification remains incomplete.
- Production provider budgets, alerting, and no-training/retention review need owner evidence.
- MCP has protocol and grant foundations, but full OAuth lifecycle, external-host compatibility, and independent security review are release gates.
- GenUI is schema constrained but remains an enhancement; it cannot replace deterministic core workflows.

### Beta readiness

- Private attachment ingestion and Storage recovery are incomplete.
- Manual keyboard and screen-reader evidence, restore/rollback drills, AI-outage drills, load/SLO evidence, and independent security review remain open.
- Supabase free-tier pausing and test-sender email are not appropriate for an external beta.

## Current Decision

The correct path is convergence, not feature expansion. Keep the long-term database, graph, canvas, collaboration, plugin, and true local-first ideas in the roadmap, but do not build them before the canonical daily loop and production shell are dependable.

## Next Deliverable

M0 is complete. Continue M1 and M2 in parallel where safe:

1. deploy the authenticated application with `PLANNER_DATA_MODEL=canonical` and complete production smoke tests;
2. retain the rollback window and copy the verified backup off-machine;
3. deepen Notes with backlinks, attachment recovery, and import/export round-trip evidence;
4. complete live-provider, AI-outage, MCP OAuth, and production monitoring certification;
5. verify manual screen-reader, keyboard, zoom, and responsive visual evidence before invite beta.

## Release Rule

Do not call the product production-ready until canonical production persistence, authentication, recovery, provider behavior, security, accessibility, and critical user journeys have been observed in the deployed environment. Local implementation is evidence, not a substitute for production verification.
