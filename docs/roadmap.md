# Planner AI Roadmap

Status: **Execution authority.** This roadmap sequences the approved first release and the gated north star. [Status](status.md) records what is actually complete.

## Delivery Rule

Build one reliable loop before expanding the platform:

`Capture -> Proposal -> Goal/Action or Note -> Today -> Review -> Activity/Undo`

Every durable capability is complete only when the UI and every approved AI surface call the same versioned Operation, authorization and Workspace isolation are tested, failure preserves user input, and the result is observable and reversible where practical.

## M0 - Re-baseline And Contain

Goal: one source of truth and a repeatable quality baseline.

- Consolidate product, experience, architecture, roadmap, status, ADR, evidence, and runbook documents.
- Keep `web/` as the only product application and remove obsolete duplicate application/schema references.
- Preserve the `/preview` route only as a gated design laboratory until its accepted patterns are ported.
- Keep legacy and canonical data modes explicit until production migration is proven.
- Require lint, format, typecheck, unit, database, build, browser, accessibility, and dependency checks.

Exit gate: documentation has one authority per concern; local baseline is green; production gaps are recorded without claiming completion.

## M1 - Canonical Production Foundation

Goal: make the tested canonical model the production reality.

- Copy the encrypted backup off-machine and complete a hosted recovery-project drill; the local isolated database restore passed on 2026-09-05.
- Reconcile the two equivalent remote migration-history entries using the reviewed metadata-only procedure.
- Verify migration history and require a no-surprise `db push --dry-run`.
- Apply the canonical cutover in a maintenance window with rollback ownership and count/integrity checks.
- Deploy with `PLANNER_DATA_MODEL=canonical`; run authentication, cross-user isolation, CRUD, export, and rollback smoke tests.
- Configure custom SMTP/domain, Google OAuth, MFA step-up, monitoring, budgets, alerts, and scheduled lifecycle jobs.

Exit gate: canonical production journeys pass, restore and rollback are proven, and legacy tables are read-only.

## M2 - Experience Convergence

Goal: turn the refined design direction into the real authenticated product.

- Extract stable tokens and shell patterns from `/preview` into production components.
- Unify navigation around Today, Planner, Notes, Review, Search, Activity, and Settings.
- Keep the assistant collapsible and contextual; preserve full-width work surfaces when closed.
- Replace preview-only data and controls with Operation-backed states.
- Complete mobile, tablet, desktop, wide-assistant, 200-percent zoom, keyboard, touch, reduced-motion, loading, empty, conflict, offline, error, and success verification.

Exit gate: the five release journeys work in the production shell without chat and pass visual/accessibility regression tests.

## M3 - Daily Planning Loop

Goal: make Planner AI useful every day without relying on AI availability.

- Capture exact typed or transcribed input and recover unsent mobile drafts.
- Review atomic AI Proposals without rewriting source Captures.
- Connect Vision to yearly/quarterly Goals and monthly/weekly Actions.
- Limit highlighted daily and weekly commitments without limiting creation.
- Require explicit rollover decisions in Weekly Review.
- Record Activity, idempotency, optimistic concurrency, and undo for every write.
- Prove UI/assistant parity for core reads and reversible writes.

Exit gate: the complete delivery-rule loop passes authenticated browser tests with AI available and unavailable.

## M4 - Notes And Knowledge Foundation

Goal: a trustworthy personal Markdown vault, not a partial Notion clone.

- Deliver a polished Markdown editor with autosave state, revisions, hierarchy, tags, links, backlinks, AI Exclusion, and caret-aware voice dictation.
- Add exact search with source links.
- Complete dry-run Notion and Obsidian import with duplicate and unsupported-content reports.
- Complete full Markdown export and restore.
- Add quarantined private attachments with owner-scoped Storage policies and lifecycle coverage.

Exit gate: the supported Markdown corpus round-trips without loss and Notes remain usable during AI failure.

## M5 - Governed Intelligence

Goal: AI that is useful because it is constrained, observable, and interchangeable.

- Finish provider-independent adapters for agent, structured analysis, transcription, and retrieval roles.
- Pass live-provider evaluation suites for correctness, evidence, injection resistance, latency, fallback, and cost.
- Make route, selection, timezone, and explicit attachments visible and editable assistant context.
- Use schema-validated GenUI only for registered components and signed Operation intents; always provide a deterministic fallback.
- Complete durable Conversations, explicit Memory, approvals, provenance, AI Exclusion, usage controls, and graceful degradation.

Exit gate: provider outage never blocks core work and every AI effect is authorized, validated, attributable, and recoverable.

## M6 - MCP And Automations

Goal: let approved external agents use the same product capabilities safely.

- Complete per-user OAuth, dynamic client registration policy, audience binding, rotating refresh tokens, revocation, and AAL2 for sensitive grants.
- Expose a small read-only Operation catalog first.
- Add reversible writes only after parity, approval, rate-limit, and compatibility tests pass.
- Keep automations visible, cancellable, narrowly scoped, and less authoritative than interactive chat.
- Keep raw SQL, service credentials, shell, repository, deployment, arbitrary network, and secret management unavailable.

Exit gate: independent security review and cross-client contract tests pass.

## M7 - Invite Beta

Goal: prove reliability and repeated usefulness with 10 to 20 invited users.

- Finish privacy, retention, account deletion, support access, incident response, and operational ownership.
- Meet 99.5 percent core availability, ordinary Operation p95 below 750 ms, 24-hour RPO, and four-hour RTO.
- Resolve all critical/high security findings and known severity-one defects.
- Measure completion of Capture, Today, Notes, and Weekly Review loops, corrections to AI Proposals, support load, latency, and cost.

Exit gate: four consecutive reliable weeks plus successful restore, rollback, AI-outage, accessibility, and security reviews.

## Post-Beta Expansion

Sequence these only after M7 evidence supports them:

1. read-only Google Calendar context, then exact-preview Calendar writes;
2. structured databases and table/board/calendar/timeline/gallery views;
3. graph and canvas over the same typed relationships;
4. stronger offline editing, then a true local-first synchronization protocol;
5. sharing, permissions, collaboration, forms, portals, and dashboards;
6. a signed, sandboxed extension model and reviewed outbound MCP.

These capabilities must reuse canonical objects and Operations. They do not introduce a second source of truth or grant AI powers before equivalent user-facing controls exist.

## Immediate Queue

M0 and the canonical schema portion of M1 passed on 2026-09-05. The active queue is:

1. Deploy with `PLANNER_DATA_MODEL=canonical` and prove authenticated production journeys.
2. Retain the rollback window and copy the verified backup off-machine.
3. Deepen the authenticated Notes and Planner journeys on the converged shell.
4. Prove the complete daily planning loop through UI and assistant parity tests.
5. Complete provider, MCP, monitoring, accessibility, and hosted recovery evidence.
