# Planner AI Current-State Audit

Status: pre-implementation baseline with implementation-evidence updates through 2026-08-22. This document describes the repository as found; accepted ADRs define target architecture.

## Executive Finding

The repository contained a useful Planner AI MVP and an imported Agent Native experiment, but not one integrated production system. The correct path was to stabilize `web`, migrate its Supabase data into the approved relational model, and timebox Agent Native feasibility. That spike concluded that v1 should adapt useful patterns directly into `web` without a sidecar or second framework database; ADR-0024 records the superseding decision.

## Application Inventory

### `web`

- Next.js 16 and React 19 product prototype.
- Supabase Auth and Postgres are used for identity and Planner data.
- Vision, yearly Goals, quarterly Goals, monthly tasks, weekly tasks, and transcripts use separate prototype tables.
- Groq-backed routes provide transcription, Socratic guidance, and SMART analysis.
- There is no migration directory, automated test suite, or CI configuration in this repository.
- Auth and interface work has uncommitted local changes and must be preserved during migration.

### `planner`

- Agent Native Chat-template experiment using Agent Native `0.133.3`.
- React Router, Nitro, Drizzle, and a separate SQL data model are present.
- Planner records are represented as generic tiered nodes, which conflicts with the approved Goal, Action, and Planning Horizon model.
- This app is an integration reference only. Its data is disposable unless explicitly exported for comparison.

### `database/schema.sql`

- One-shot MVP SQL intended for manual execution in the Supabase editor.
- Creates separate tables for each planning horizon and uses user-level ownership without the approved Workspace model.
- Is not an idempotent migration chain and must not be used to create the target database.

## Confirmed Pre-Implementation Risks

| Risk                 | Evidence                                                                                                             | Required containment                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI route abuse       | Current AI endpoints are not consistently protected by authenticated, per-user authorization and distributed quotas. | Authenticate every route, validate bounded inputs, add per-user quotas and safe provider errors, and disable unused endpoints.                                 |
| Data-model drift     | `web` uses horizon tables while `planner` uses generic nodes.                                                        | Implement the approved relational model in versioned Supabase migrations; do not dual-write both models.                                                       |
| Ownership gaps       | Parent-child ownership is not consistently enforced by database constraints.                                         | Add Workspace-scoped composite foreign keys, RLS `USING` and `WITH CHECK` policies, and cross-user tests.                                                      |
| Non-atomic writes    | Some multi-record mutations can partially succeed.                                                                   | Route durable writes through transaction-backed Operations with idempotency receipts.                                                                          |
| Capture integrity    | Generic text cleanup can alter raw transcript whitespace, and failed audio is held only in browser memory.           | Preserve exact raw Capture text and durably retain encrypted failed audio for no more than seven days.                                                         |
| Agent authority      | A full Agent Native template includes capabilities Planner AI must not expose in production.                         | Adapt only reviewed product patterns; do not ship code execution, arbitrary extensions, shell, repository, deployment, secret access, or the imported runtime. |
| Framework coupling   | Merging either imported application wholesale would combine incompatible framework and migration ownership.          | Keep `web` as the one product/runtime and Supabase as the one first-release system of record.                                                                  |
| Recovery uncertainty | The current database and Storage recovery process is not represented as tested infrastructure.                       | Back up before migration, document ownership, and pass restore drills before external beta.                                                                    |

## Decisions That Close The Risks

- The canonical product domain is the relational model in `database_schema.md`; generic nodes and per-horizon tables are migration sources only.
- All surfaces call one transport-neutral Operation service. Planning Actions and software Operations remain different concepts.
- Supabase is authoritative for domain and first-release assistant state. There is no Agent Native framework database in v1.
- The browser never supplies trusted identity to Operations. Server-verified Supabase identity and Workspace ownership protect UI, chat, and MCP gateways.
- External content, attachments, web pages, imported Notes, and MCP responses are untrusted data, never instructions.
- Production code execution and arbitrary extension installation are disabled. Outbound MCP connections arrive only after invite beta under explicit OAuth grants and allowlists.
- Support has no standing ability to read private content or impersonate a user. User-visible Activity records important reads and durable changes.

## Required Evidence Before Feature Expansion

1. Current Supabase schema and data are backed up and migration counts are recorded.
2. Authenticated AI routes reject anonymous, oversized, malformed, and over-quota requests.
3. A fresh local database can be created from migrations and passes RLS isolation tests.
4. Existing core writes execute through the Operation service and are transaction-safe.
5. CI runs lint, typecheck, build, unit, database, and browser smoke checks.
6. A timeboxed Agent Native spike reaches an adopt/adapt/reject decision. ADR-0024 records the completed adapt-without-runtime result.

## Audit Limitations

This audit is based on repository code and documentation. Supabase dashboard settings, production environment variables, provider account settings, deployed Vercel configuration, and live backup status must be verified through their administrative surfaces before release claims are made.

## Final Review Evidence

Document-set review was verified on 2026-08-16. Implementation evidence was refreshed on 2026-08-17:

- all 56 accepted decisions are unique and sequential;
- all 24 functional and 12 nonfunctional requirements are unique and sequential;
- all 81 roadmap tickets are unique, reference existing tickets, and form an acyclic dependency graph;
- all local links and Markdown tables in the canonical set are valid;
- canonical documents contain no unresolved TODO/TBD markers, trailing whitespace, or non-ASCII punctuation;
- `web` passes ESLint, TypeScript checking, 107 unit tests, a 35-page production build, and 32 desktop/mobile Playwright tests, including automated WCAG A/AA checks on public critical flows, Capture/Review Proposal authentication, and scheduler authentication;
- the fourteen-case live assistant behavioral gate includes recurring Action creation/materialization, notification dismissal, and reviewed Capture Proposal approval, and is paced to the configured provider account's 8,000-token-per-minute ceiling;
- the separate three-case `assistant-v11` owner-scoped read gate passed against Groq on 2026-08-21 for bounded search, exact record selection, and write/read confusion;
- the six-case Capture/Review gate passed against Groq on 2026-08-21; every `assistant-v11` fixture has individual passing evidence, while the latest all-14 process passed twelve and received provider 429 responses for the final two, so one clean all-14 process remains pending;
- the package tree passes a current npm audit with zero vulnerabilities;
- 54 migrations and 42 pgTAP suites exist with balanced migration framing and matching test plans; a clean local replay and all 841 database assertions passed on 2026-08-22. Stage-0 security and legacy-helper hardening ran remotely, while canonical migration remains blocked pending explicit cutover approval plus backup/rollback evidence or an approved branch;
- `planner` typecheck and test commands could not complete because the imported Agent Native CLI attempted a package reinstall while registry access was unavailable. This reference app remains outside the product release baseline; PAI-501 concluded with the adapt-without-runtime decision in ADR-0024.

These checks validate local consistency and buildability, not production readiness. Remote migration, database tests, provider configuration, authenticated canonical journeys, private attachment controls, recovery drills, and independent security review remain release gates.
