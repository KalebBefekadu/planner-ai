# Planner AI Status

Updated: 2026-09-07

## Executive Assessment

Planner AI has a substantial, well-tested application foundation, but it is not a finished product or production-ready beta. The canonical production schema, RLS, versioned Operations, AI safety boundaries, recovery-aware workflows, and broad automated tests are now in place. The largest remaining gap is product depth: the authenticated shell has begun converging with `/preview`, but several long-term knowledge, collaboration, and agent capabilities remain staged rather than complete.

Estimated completion:

- **Private dogfood product:** about 75 percent.
- **Safe invite beta:** about 54 percent.
- **Full long-term Notion/Obsidian/AI-native vision:** about 27 percent.

These percentages describe validated capability, not code volume.

## Verified Locally

Fresh checks on 2026-09-07:

- ESLint passes.
- TypeScript passes with no emitted output.
- Prettier passes for source and tests.
- Next.js production build passes and generates 38 routes, including canonical `/planner` and compatibility redirect `/goals`.
- Vitest passes: 45 files, 537 tests.
- pgTAP passes: 50 files, 946 assertions.
- The local Supabase reset/migration chain and database advisors passed in the preceding full verification.
- The canonical authenticated Playwright corpus passes 170 desktop and mobile tests with 14 skipped, run against a production build rather than a development server, including Capture, Planner, Calendar scheduling, MFA-protected Notes vault export, round-trip re-import, and restore into a workspace that no longer holds the originals, Note reordering and reparenting, Today, authenticated accessibility, mobile keyboard navigation, auth-boundary, and assistant-outage journeys.
- The authenticated assistant outage journey proves a failed request remains visible and can be retried without duplicating user input.
- The manual MCP lifecycle has browser evidence on desktop and mobile: an AAL2 session creates a read-scoped token, a standards-compliant client discovers only its granted tool, and revocation immediately returns `401`. This work found and corrected a Postgres ambiguity that had caused every otherwise-valid manual token to be rejected.
- Every progress bar, chart bar, indentation, and sidebar width now actually renders at its size. The Content Security Policy authorises stylesheets and style elements by nonce, and a nonce does not extend to a style attribute, so everything sized with one was parsed and discarded: the AI budget bar sat empty however much had been spent, the usage chart was flat whatever the traffic, Goal progress showed nothing, and the Note outline was unindented. Development allows inline styles, so this was only ever visible in a real build. The policy was not widened to fix it, because `style-src-attr` is not supported everywhere and `'unsafe-inline'` is ignored on `style-src` once a nonce is present; bounded sets became classes and genuinely dynamic values are written through the CSSOM, which the policy does not restrict.
- A conflicting save reports the conflict instead of a timeout, and says so in words the person can act on. Two defects were stacked here. Optimistic concurrency raised its conflict as SQLSTATE 40001, which means serialization_failure, so PostgREST answered 504 "The upstream server is timing out" and discarded the message; the editor then retried a write that could never succeed. Underneath that, a production build strips the message off any error thrown out of a Server Action, so every carefully written failure message in the product reached people as a minified React error. Both were invisible while the browser corpus ran against a development server, which shows those messages and does not redact them.
- The workspace stops animating when the operating system asks it to. Only a loading skeleton had honoured that preference; every colour fade, sliding control, and spinning busy indicator ignored it, so a person who set the preference because movement makes them ill still got 160 milliseconds of motion on every interaction. Durations are collapsed rather than removed, so anything waiting on a transition to end is still told it ended.
- Today, Planner, Notes, Review, and Preferences reflow at 320 CSS pixels, which is a 1280 pixel window zoomed to 400 percent, without forcing a person to scroll sideways to read a line. Both of these gates were confirmed to fail without their fix rather than passing vacuously.
- A client that goes away mid-request no longer ends the server for everyone else. A React Server Component stream cancelled by a navigation, an abandoned upload, or a dropped connection surfaces to Node as an uncaught exception with no listener, which terminated the process; the server now records the disconnect and keeps serving, while any fault that is not a disconnect still ends the process rather than continuing from unknown state.
- The browser corpus runs against a production build rather than the dev server, and now passes repeatedly at full concurrency with no test left unrun. It had been collapsing intermittently: a cancelled request ended the dev process, and every later test then failed with a connection error against a server that was simply gone, which reads as a broad regression rather than one cancelled request. Running the corpus against what actually ships also removed the dev-only behaviour these journeys were quietly certifying. The change exposed six latent test defects that slower dev timing had hidden, each of which could have passed while proving nothing:
  - a Note titled after one of the editor's own controls matched that control as well as its place in the tree;
  - a Capture and a weekly Action were confirmed against text still sitting in the form that created them, so the assertion could pass without anything being saved;
  - creating a Note while another was open waited for an address pattern that already matched, so the editor was inspected before the new Note existed;
  - committing five Actions in a row dropped one to a re-render, so the daily cap appeared to refuse a commitment it had never received;
  - the dark-mode accessibility scan measured colours mid-transition, reporting contrast failures against blends the page never rests on.
- Completing a Notes import no longer destroys the report of what was imported. The workspace is remounted whenever the active Note changes so one Note's text can never appear over another's draft, and an import into a workspace with nothing selected made the first imported Note active, which took the dialog down with it mid-import. A person could restore a vault and never learn how much arrived or what was skipped.
- A Note can be filed under any Note the hierarchy allows, including back out to the top level, and the destinations that would detach a branch are never offered. The server re-checks the destination against the live tree rather than trusting the page, so a stale page cannot file a Note under something that has since become its own descendant.
- A Note can be moved under the Note above it and back out of its parent from the interface, and the new place survives a reload as a persisted Operation. Indent and outdent are used rather than dragging, so changing the hierarchy needs no pointer and stays reachable from a keyboard.
- The Notes tree is real nesting rather than a flat run of buttons with indentation. Two defects were hidden in that: a screen reader read every Note as a peer however deeply it was filed, and the narrow layout overrode the indentation outright, so on a phone a child Note was indistinguishable from a root one. Structure now carries the hierarchy, so what a person sees and what assistive technology hears cannot disagree.
- A Note can be reordered among its siblings from the interface, the new order survives a reload as a persisted Operation, and a Note at the edge of its level is offered the unavailable direction as disabled rather than as a control that quietly does nothing. Ordering was previously reachable only through the assistant or MCP, which made the arrangement of a person's own knowledge base something only an agent could set.
- The Notes vault now round-trips and restores. A downloaded vault is re-imported in the authenticated Notes journey and every Note returns as an exact duplicate, with nothing unsupported and no export frontmatter left in the body. The same journey then archives the originals and imports the vault again, which is the case a person actually needs: both Notes are recreated and the child returns beneath its parent rather than flattened to the root. Restored Notes now also keep the sibling order the manifest recorded. Building that evidence found six defects, each of which silently degraded an exported vault rather than failing visibly:
  - the ZIP reader never read the vault manifest, so every archived vault fell back to generic folder import and lost the identity and hierarchy the manifest carried;
  - export frontmatter was never stripped back off, so restored bodies carried raw export metadata;
  - a Note whose title matched a de-duplicated filename overwrote another Note's body in the archive;
  - the import validated hierarchy as folder nesting, so a vault containing a nested Note was rejected outright, and its staging order could create a child before its parent and silently reparent it to the root;
  - export appended a trailing newline the stored body did not have, so restoring a vault into its own workspace reported all of it as new instead of recognising what was already there;
  - the import discarded the sibling order the manifest recorded, so every restored Note was renumbered by staging order and siblings came back in an order the owner never chose.
- The dependency audit reports no known vulnerabilities at the configured high-severity threshold.

Implemented local capability includes verified authentication boundaries, canonical relational migrations, owner-isolating RLS, versioned Operation dispatch, Activity and undo, Today, Vision/Goals/Actions, Planner calendar, Capture and voice transcription routes, atomic Proposals, Weekly/Monthly/Quarterly Review, Notes with source-authoritative Markdown, direct reordering and reparenting, and a guarded rich-editor adapter, exact search, onboarding, settings, notifications, Conversations, explicit Memory, AI Exclusion, Trash, export, cancellable account deletion, PWA Capture recovery, assistant evidence/safety controls, GenUI schema validation, and scoped MCP endpoints.

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
- Vault export and import now round-trip the supported corpus without loss. AI Exclusion survives a restore so an excluded Note is not quietly returned to AI retrieval, and a restored Note keeps the exact sibling order the manifest recorded, including the fractional keys a reorder produces. Reordering and reparenting are now direct click-first controls rather than assistant-only capabilities. Filing a Note anywhere in the hierarchy is now a direct control as well, so nothing about a Note's place remains assistant-only.

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
- Reflow at 400 percent zoom and the reduced-motion preference are now covered automatically. Manual keyboard and screen-reader evidence, restore/rollback drills, AI-outage drills, load/SLO evidence, and independent security review remain open, and none of them can be closed from a development machine.
- Supabase free-tier pausing and test-sender email are not appropriate for an external beta.

## Current Decision

Running the browser corpus against a production build rather than a development server was the single highest-yield change in this pass. A development server allows inline styles and shows the message on any error thrown out of a Server Action; a real build does neither. Four defects were hiding in exactly that gap, each of which looked correct throughout development and reached nobody in production: every failure message, every progress bar and chart, the conflict path, and the reduced-motion preference. Any further work that claims a user-visible result should be verified the same way.

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
