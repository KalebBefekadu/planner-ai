# Planner AI Status

Updated: 2026-09-06

## Executive Assessment

Planner AI has a substantial, well-tested application foundation, but it is not a finished product or production-ready beta. The canonical production schema, RLS, versioned Operations, AI safety boundaries, recovery-aware workflows, and broad automated tests are now in place. The largest remaining gap is product depth: the authenticated shell has begun converging with `/preview`, but several long-term knowledge, collaboration, and agent capabilities remain staged rather than complete.

Estimated completion:

- **Private dogfood product:** about 70 percent.
- **Safe invite beta:** about 50 percent.
- **Full long-term Notion/Obsidian/AI-native vision:** about 25 percent.

These percentages describe validated capability, not code volume.

## Verified Locally

Fresh checks on 2026-09-06:

- ESLint passes.
- TypeScript passes with no emitted output.
- Prettier passes for source and tests.
- Next.js production build passes and generates 38 routes, including canonical `/planner` and compatibility redirect `/goals`.
- Vitest passes: 43 files, 513 tests.
- pgTAP passes: 46 files, 910 assertions.
- The local Supabase reset/migration chain and database advisors passed in the preceding full verification.
- The canonical authenticated Playwright corpus passes 123 desktop and mobile tests, including Capture, Planner, Calendar scheduling, MFA-protected Notes vault import and export, Today, authenticated accessibility, mobile keyboard navigation, auth-boundary, and assistant-outage journeys.
- The authenticated assistant outage journey proves a failed request remains visible and can be retried without duplicating user input.
- The Notes vault now has export/import round-trip evidence. Writing that test found three defects that made an exported vault lossy on re-import: the ZIP reader never read the vault manifest, so archives silently degraded to generic folder import; export frontmatter was never stripped back off; and a Note whose title matched a de-duplicated filename overwrote another Note's body. All three are fixed and covered.
- The dependency audit reports no known vulnerabilities at the configured high-severity threshold.

Implemented local capability includes verified authentication boundaries, canonical relational migrations, owner-isolating RLS, versioned Operation dispatch, Activity and undo, Today, Vision/Goals/Actions, Planner calendar, Capture and voice transcription routes, atomic Proposals, Weekly/Monthly/Quarterly Review, Notes with source-authoritative Markdown and a guarded rich-editor adapter, exact search, onboarding, settings, notifications, Conversations, explicit Memory, AI Exclusion, Trash, export, cancellable account deletion, PWA Capture recovery, assistant evidence/safety controls, GenUI schema validation, and scoped MCP endpoints.

The daily-planning loop now has browser evidence that a typed Capture persists into Today, Vision-to-yearly/quarterly/monthly/weekly planning creates the expected hierarchy, a completed Goal remains visible rather than being accidentally archived, daily focus survives reload, completed Actions leave the open list, and the five-item focus cap limits commitment rather than creation.

## Production Evidence

- The configured production Session Pooler accepted an independent read-only query.
- A production logical backup was encrypted, checksummed, decrypted, and accepted by `pg_restore --list`.
- The same archive restored successfully into a disposable local Supabase Postgres 17 instance; 8 public tables, all 8 RLS-enabled, and 5 public functions were verified before the instance and plaintext archive were destroyed.
- Read-only catalog inspection found two remote-only migration-history entries whose effects match reviewed local hardening migrations.
- The two duplicate remote migration entries were reconciled to the reviewed local versions.
- The hosted migration history and guarded cutover preflight are aligned through `20260906114500_recoverable_note_attachment_removal.sql` after a fresh encrypted backup.
- Count-only production verification found 53 public tables, all 53 RLS-enabled, two Auth users mapped to two Workspaces, no unmigrated users, and 56 registered Operations.
- Vercel built release commit `1d570e4` successfully, and a read-only inspection on 2026-09-06 found current `planner-ai` production deployments in Ready state. Their team-scoped production aliases redirect to Vercel SSO before reaching the application, so anonymous application smoke tests remain blocked at the platform edge.
- `planner-ai.vercel.app` is not this application: it still serves the older Planner-AI Telegram-bot site and must not be published as the current product URL.
- [Migration reconciliation](runbooks/migration-reconciliation.md) records the completed procedure and evidence.

Legacy tables remain available for rollback while the deployed application is switched to canonical mode.

## Critical Gaps

### Product convergence

- `/preview` remains a design laboratory, but its rail, contextual sidebar, command palette, restrained visual system, and responsive navigation are now used by the authenticated shell.
- Planner now adds real-data horizon filtering, progress summaries, and a stronger direction-to-action hierarchy; Notes adds clearer document metadata, serialized autosave, backlinks, caret-aware voice dictation, and portable Markdown vault export/restore.
- Legacy/canonical mode branches remain until the deployed canonical release is verified and the rollback window closes.
- Several north-star screens are illustrative rather than connected to real Operations.
- Notes now offer a source-authoritative rich editor for a proven reversible Markdown subset, including GFM task lists and tables, but they are not yet the complete editor, graph, canvas, or database system in the long-term vision.
- Vault export and import now round-trip the supported corpus without loss, but re-import still discards per-Note AI Exclusion and sort order, which the export records in frontmatter and the import ignores.

### Production data and operations

- Canonical schema cutover is complete; the Vercel build is deployed, but the application-mode switch and anonymous/authenticated smoke tests still require access to the current Vercel project settings.
- Database backup integrity and local isolated restoration are proven; off-machine custody and a hosted recovery-project drill covering Auth, Storage, and managed configuration remain unverified.
- The production database has a service-role-only lifecycle worker-run ledger, but Vercel production environment values, deployment protection, production domain ownership, custom SMTP/domain, external alert routing, cron ownership, and authenticated production journeys are not fully re-verified.

### AI and external agents

- Deterministic AI tests pass, but the last full live-provider corpus encountered provider rate limits; fallback certification remains incomplete.
- Production provider budgets, alerting, and no-training/retention review need owner evidence.
- MCP has protocol and grant foundations, but full OAuth lifecycle, external-host compatibility, and independent security review are release gates.
- GenUI is schema constrained but remains an enhancement; it cannot replace deterministic core workflows.

### Beta readiness

- Private Notes attachment intake, owner-scoped metadata, checksums, quarantine state, download gating, recoverable removal, and a protected purge path are implemented. Malware scanning approval and production Storage backup/recovery evidence remain incomplete.
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
