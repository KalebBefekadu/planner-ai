# Planner AI Engineering Improvement Program

Status: **supporting architecture register.** The
[roadmap](../roadmap.md) owns execution order and release gates. This document
defines the engineering outcomes that support the personal MVP and the accepted
[product shape](../product/product-shape.md); it does not create a parallel
feature roadmap.

## Direction

Keep Planner AI as a modular monolith on Next.js, React, TypeScript, TipTap,
Supabase/Postgres, Supabase Storage, and Vercel. Improve the enforcement of the
existing architecture before considering a framework rewrite, microservices, a
second data authority, or an unrestricted agent runtime.

Knowledge and Planning are separate product pillars over one shared spine:

```text
UI | Assistant | MCP | lifecycle workers
                 |
        thin surface adapters
                 |
      versioned Operation contract
                 |
Knowledge | Planning | Capture | Review | Identity
                 |
 Postgres transaction + Activity + durable outbox
                 |
   private Storage | workers | content-free telemetry
```

"One spine" means shared identity, search, links, Operations, Activity, and
recovery. It does not mean collapsing Notes, Goals, Actions, Captures, or Reviews
into a generic node table.

## Seven engineering outcomes

### EH-01 — Least-privilege server access

- Remove `service_role` use from ordinary authenticated and agent-facing request
  handlers.
- Reserve the admin client for an explicit lifecycle-job allowlist enforced in
  CI.
- Use narrowly granted RPCs or a restricted, non-`BYPASSRLS` server role for
  trusted operations that cannot use the person's JWT.
- Model attachment upload as reserve, upload, finalize, and reconcile so Storage
  and metadata failures are repairable.

**Gate:** no user-facing route can instantiate the admin client; cross-Workspace
negative tests and attachment orphan-recovery tests pass.

### EH-02 — Reproducible delivery

- Keep the integration branch green before feature work merges.
- Enforce one active implementation contract and remove superseded branches and
  task claims promptly.
- Give each worker an isolated Supabase stack or serialize database access with
  an explicit lock.
- Generate types only after a clean database reset and fail CI on schema,
  migration, grant, or generated-type drift.

**Gate:** two independent worktrees can run their assigned checks without
changing one another's database or generated output.

### EH-03 — Sustainable module boundaries

- Split large Workspace components into server view models, client controllers,
  pure state transitions, focused presentation components, and component-local
  styles.
- Keep Server Actions and Route Handlers as authentication, validation, and
  translation adapters rather than domain implementations.
- Remove the superseded Preview implementation as authenticated surfaces pass
  their parity gates.

**Gate:** no critical workflow depends on a second product implementation, and
the Notes, Planner, Today, Review, Capture, and assistant shells can be tested
through focused modules.

### EH-04 — One executable Operation contract

- Maintain one typed manifest for Operation ID, major version, schemas, risk,
  exposure, reversibility, and owning domain.
- Derive assistant and MCP catalogs from that manifest.
- Compare the manifest with the live local `operation_contracts` rows in CI.
- Replace the growing rename-and-wrap SQL dispatcher chain with stable domain
  dispatchers and one explicit top-level router while preserving old versions.

**Gate:** TypeScript and Postgres expose exactly the same Operation contract, and
every exposed surface passes compatibility, authorization, idempotency, receipt,
and undo tests where applicable.

### EH-05 — A readable current database schema

- After the personal MVP, introduce domain-organized declarative schema files as
  the readable current state.
- Continue producing reviewed, forward-only migrations; never rewrite deployed
  migration history.
- Keep policies, grants, functions, indexes, and fixed `search_path` declarations
  visible beside the tables they protect.

**Gate:** a clean reset, generated diff, database tests, advisors, and generated
types agree without manual SQL.

### EH-06 — Content-free production observability

- Trace Operation ID/version, result, latency, database time, provider class,
  fallback, job age, and stable failure code without recording private content.
- Publish SLO dashboards and alerts for Operation latency/error rate, migration
  mismatch, provider failure, stuck jobs, backup freshness, and restore evidence.
- Correlate browser-safe request IDs, server traces, Operation receipts, and
  lifecycle runs.

**Gate:** every critical production failure can be located by stable request or
receipt ID without placing Note, Capture, prompt, transcript, filename, or secret
content in telemetry.

### EH-07 — One durable job model

- Enqueue background work atomically with the initiating domain transaction.
- Standardize leasing, visibility timeout, attempts, exponential retry,
  idempotency, cancellation, dead-letter state, and content-free failure codes.
- Apply the model to AI analysis, transcription, import/export, indexing,
  notifications, attachment reconciliation, and deletion workflows according to
  their risk and latency needs.

**Gate:** a worker crash or deployment cannot lose a job, duplicate its durable
effect, or leave it permanently invisible to the owner or operator.

## Small stack corrections

- Match Node type definitions to the pinned Node 24 runtime.
- Match `eslint-config-next` to the installed Next.js release.
- Pin direct production and security-sensitive packages; update them in reviewed,
  grouped changes with the committed lockfile.
- Add focused coverage thresholds for Operations, authentication, Markdown
  conversion, offline Capture, and provider policy rather than chasing a global
  percentage.
- Pin third-party CI actions to reviewed commit SHAs and produce a dependency
  inventory during release builds.

## Product-shape sequence after personal dogfood

1. Make Knowledge and Planning visible as the two pillars, with Knowledge as the
   front door.
2. Add simple shared Workspaces: owner plus one flat `member` role, after the
   authorization seam has been proven under single-owner behavior.
3. Surface the shared spine: inline page Actions, page-to-Action navigation,
   backlinks, graph, and unified search.
4. Add typed page properties and saved table, board, and calendar views without
   replacing the explicit planning model.
5. Prove ownership through zero-loss export/re-import and evaluate an opt-in
   read-only folder mirror.

True local-first editing, richer collaboration, and sandboxed extensions remain
separate architecture gates. No implementation may dual-write Markdown and
Postgres or introduce another source of truth without an accepted ADR covering
identity, ordering, conflicts, encryption, recovery, and schema migration.

## Execution order

Before private release, prioritize EH-02, the small stack corrections, EH-01,
and the minimum viable EH-06 production signals. Complete the existing personal
MVP workflow, import, assistant/MCP, backup, and dogfood gates before shared
Workspaces or post-MVP schema expansion.

EH-03 and EH-04 proceed as focused refactors around active product slices. EH-05
and EH-07 follow the personal MVP unless a release-critical correctness or
reliability defect requires an earlier bounded change.
