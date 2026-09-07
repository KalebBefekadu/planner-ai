# Planner AI Status

Updated: 2026-09-07

## Executive Assessment

Planner AI has a substantial, well-tested application foundation, but it is not a finished product or production-ready beta. The canonical production schema, RLS, versioned Operations, AI safety boundaries, recovery-aware workflows, and broad automated tests are now in place. The largest remaining gap is product depth: the authenticated shell has begun converging with `/preview`, but several long-term knowledge, collaboration, and agent capabilities remain staged rather than complete.

Estimated completion:

- **Private dogfood product:** about 70 percent.
- **Safe invite beta:** about 50 percent.
- **Full long-term Notion/Obsidian/AI-native vision:** about 25 percent.

These percentages describe validated capability, not code volume.

## Verified Locally

Fresh checks on 2026-09-07:

- ESLint passes.
- TypeScript passes with no emitted output.
- Prettier passes for source and tests.
- Next.js production build passes and generates 38 routes, including canonical `/planner` and compatibility redirect `/goals`.
- Vitest passes: 45 files, 529 tests.
- pgTAP passes: 49 files, 942 assertions.
- The local Supabase reset/migration chain and database advisors passed in the preceding full verification.
- The canonical authenticated Playwright corpus passes 152 desktop and mobile tests with 2 skipped, including Capture, Planner, Calendar scheduling, MFA-protected Notes vault export, round-trip re-import, and restore into a workspace that no longer holds the originals, Note reordering, Today, authenticated accessibility, mobile keyboard navigation, auth-boundary, and assistant-outage journeys.
- The authenticated assistant outage journey proves a failed request remains visible and can be retried without duplicating user input.
- The manual MCP lifecycle has browser evidence on desktop and mobile: an AAL2 session creates a read-scoped token, a standards-compliant client discovers only its granted tool, and revocation immediately returns `401`. This work found and corrected a Postgres ambiguity that had caused every otherwise-valid manual token to be rejected.
- A client that goes away mid-request no longer ends the server for everyone else. A React Server Component stream cancelled by a navigation, an abandoned upload, or a dropped connection surfaces to Node as an uncaught exception with no listener, which terminated the process; the server now records the disconnect and keeps serving, while any fault that is not a disconnect still ends the process rather than continuing from unknown state. This was found as an intermittent collapse of the browser corpus, where one aborted request took the server down and every later test failed with a connection error against a server that was simply gone.
- A Note can be reordered among its siblings from the interface, the new order survives a reload as a persisted Operation, and a Note at the edge of its level is offered the unavailable direction as disabled rather than as a control that quietly does nothing. Ordering was previously reachable only through the assistant or MCP, which made the arrangement of a person's own knowledge base something only an agent could set.
- The Notes vault now round-trips and restores. A downloaded vault is re-imported in the authenticated Notes journey and every Note returns as an exact duplicate, with nothing unsupported and no export frontmatter left in the body. The same journey then archives the originals and imports the vault again, which is the case a person actually needs: both Notes are recreated and the child returns beneath its parent rather than flattened to the root. Restored Notes now also keep the sibling order the manifest recorded. Building that evidence found six defects, each of which silently degraded an exported vault rather than failing visibly:
  - the ZIP reader never read the vault manifest, so every archived vault fell back to generic folder import and lost the identity and hierarchy the manifest carried;
  - export frontmatter was never stripped back off, so restored bodies carried raw export metadata;
  - a Note whose title matched a de-duplicated filename overwrote another Note's body in the archive;
  - the import validated hierarchy as folder nesting, so a vault containing a nested Note was rejected outright, and its staging order could create a child before its parent and silently reparent it to the root;
  - export appended a trailing newline the stored body did not have, so restoring a vault into its own workspace reported all of it as new instead of recognising what was already there;
  - the import discarded the sibling order the manifest recorded, so every restored Note was renumbered by staging order and siblings came back in an order the owner never chose.
- The dependency audit reports no known vulnerabilities at the configured high-severity threshold.

Implemented local capability includes verified authentication boundaries, canonical relational migrations, owner-isolating RLS, versioned Operation dispatch, Activity and undo, Today, Vision/Goals/Actions, Planner calendar, Capture and voice transcription routes, atomic Proposals, Weekly/Monthly/Quarterly Review, Notes with source-authoritative Markdown, direct sibling reordering, and a guarded rich-editor adapter, exact search, onboarding, settings, notifications, Conversations, explicit Memory, AI Exclusion, Trash, export, cancellable account deletion, PWA Capture recovery, assistant evidence/safety controls, GenUI schema validation, and scoped MCP endpoints.

The daily-planning loop now has browser evidence that a typed Capture persists into Today, Vision-to-yearly/quarterly/monthly/weekly planning creates the expected hierarchy, a completed Goal remains visible rather than being accidentally archived, daily focus survives reload, completed Actions leave the open list, and the five-item focus cap limits commitment rather than creation.

## Production Evidence

- The configured production Session Pooler accepted an independent read-only query.
- A production logical backup was encrypted, checksummed, decrypted, and accepted by `pg_restore --list`.
- The same archive restored successfully into a disposable local Supabase Postgres 17 instance; 8 public tables, all 8 RLS-enabled, and 5 public functions were verified before the instance and plaintext archive were destroyed.
- Read-only catalog inspection found two remote-only migration-history entries whose effects match reviewed local hardening migrations.
- The two duplicate remote migration entries were reconciled to the reviewed local versions.
- A fresh encrypted backup on 2026-09-07 was checksummed, decrypted, and restored into an isolated local Supabase Postgres instance: 55 public tables, all 55 RLS-enabled, and 128 public functions passed validation.
- Hosted migration history remains aligned through `20260906114500_recoverable_note_attachment_removal.sql`. Read-only preflight correctly stops on four newer local migrations: the three Notes-vault migrations (`20260906181500`, `20260906190000`, and `20260907093121`) and the MCP manual-token authentication repair (`20260907091945`); none has been applied to production.
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
- Vault export and import now round-trip the supported corpus without loss. AI Exclusion survives a restore so an excluded Note is not quietly returned to AI retrieval, and a restored Note keeps the exact sibling order the manifest recorded, including the fractional keys a reorder produces. Reordering is now a direct click-first control rather than an assistant-only capability; dragging a Note to a new parent is still unavailable, so changing a Note's place in the hierarchy remains an assistant or MCP Operation.

### Production data and operations

- Canonical schema cutover is complete through the prior release. The three newer Notes-vault migrations and the MCP manual-token authentication repair remain pending a recorded maintenance window, remote pgTAP plan, rollback owner, and post-cutover authenticated smoke plan; the Vercel application-mode switch and authenticated smoke tests also still require access to the current Vercel project settings.
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
