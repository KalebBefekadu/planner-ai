# Planner AI Canonical Data Model

Status: **Approved logical model.** Physical SQL is delivered through reviewed Supabase migrations. Historical prototype SQL remains available in Git history and is not a schema source.

## Modeling Rules

1. Supabase Postgres is authoritative for Planner AI domain data.
2. Every domain row belongs to one `workspace_id`; first-release Workspaces have one owner.
3. Related rows use Workspace-scoped composite foreign keys so records from different Workspaces cannot be linked.
4. Vision, Goal, Action, Capture, Note, Review, and Memory are explicit entities. There is no generic planning-node table and no table per Planning Horizon.
5. Archive and Trash are different. `archived_at` hides completed/inactive material; `trashed_at` begins the 30-day recoverable deletion lifecycle.
6. Durable writes use the Operation service. Multi-record changes, Activity, idempotency, and approvals commit atomically.
7. Timestamps are UTC. Planning dates use a Workspace IANA timezone and a date-based Planning Horizon.
8. User-authored raw content is never overwritten by AI output.
9. Every referenced domain table has `unique (id, workspace_id)` so composite foreign keys can enforce same-Workspace relationships.
10. Polymorphic foreign keys are not used for first-release relationships; each supported relationship has an explicit junction table.

## Identity And Ownership

### `workspaces`

- `id uuid primary key`
- `owner_user_id uuid not null references auth.users(id)`
- `name text not null`
- `timezone text not null`
- `week_starts_on smallint not null default 1`
- `coaching_intensity text not null`
- `created_at`, `updated_at`
- `unique (owner_user_id)` for exactly one Workspace per owner in the first release

RLS authorizes through Workspace ownership. Domain tables store `workspace_id`, not a duplicated `user_id`. Every table has an index beginning with `workspace_id` for RLS and common queries.

## Planning Domain

### `visions`

One active Vision per Workspace. It stores the person's long-form direction, not a Goal.

- `id`, `workspace_id`, `body_markdown`
- `created_at`, `updated_at`, `archived_at`, `trashed_at`, `purge_after`
- partial unique constraint for one non-trashed active Vision per Workspace

### `planning_horizons`

Materialized date boundaries used for stable history and Review.

- `id`, `workspace_id`
- `kind`: `year`, `quarter`, `month`, or `week`
- `starts_on`, `ends_on`
- `timezone_snapshot`
- unique `(workspace_id, kind, starts_on)`

Goals link only to yearly or quarterly Horizons. Actions link only to monthly or weekly Horizons. Database constraints or triggers enforce those invariants.

### `goals`

- `id`, `workspace_id`, `vision_id`, `horizon_id`
- optional `parent_goal_id` for a quarterly Goal connected to a yearly Goal
- `title`, optional `description_markdown`
- `status`: `draft`, `active`, `paused`, `achieved`, or `abandoned`
- optional `target_value`, `current_value`, `unit`, `due_on`
- `created_at`, `updated_at`, `archived_at`, `trashed_at`, `purge_after`
- optimistic-concurrency `version bigint`

Constraints require yearly Goals to have no parent and quarterly Goals to reference a yearly Goal in the same Workspace.

Goal Progress uses outcome fields or explicit user assessment. It is never computed solely from completed Actions.

### `actions`

- `id`, `workspace_id`, optional `goal_id`, `horizon_id`
- optional `source_note_id`, `recurrence_template_id`
- `title`, optional `description_markdown`
- `status`: `open`, `in_progress`, `blocked`, `done`, or `dropped`
- optional `scheduled_on`, `completed_at`, `blocker_text`, `drop_reason`
- `created_at`, `updated_at`, `archived_at`, `trashed_at`, `purge_after`
- optimistic-concurrency `version bigint`

### `action_schedule_history`

Append-only history for every scheduling or rollover decision.

- `id`, `workspace_id`, `action_id`
- previous/new Horizon and date
- reason: `scheduled`, `rescheduled`, `reduced`, `blocked`, `dropped`, or `left_overdue`
- actor and timestamp

### `recurrence_templates`

Simple weekly or monthly templates only. Generation is idempotent and each occurrence is an ordinary Action.

## Capture And AI Proposal Domain

### `captures`

Immutable user-authored source text.

- `id`, `workspace_id`
- `raw_text` preserved exactly after boundary-safe encoding validation
- `source`: `typed`, `voice`, or `import`
- `state`: `new`, `proposed`, `reviewed`, or `archived`
- optional audio object reference, transcription status, and seven-day failure expiry
- `created_at`, `archived_at`, `trashed_at`, `purge_after`

Normal product roles cannot update `raw_text`. Corrections create a new Capture or an explicit linked annotation.

### `proposals`

- `id`, `workspace_id`, `capture_id` or `review_id`
- `status`: `pending`, `applied`, `dismissed`, `superseded`, or `failed`
- provider/model/prompt/evaluation version metadata
- source snapshot hash and creation timestamp

### `proposal_items`

Typed suggested changes such as Action creation, Note edit, Goal link, tag, blocker, progress update, or reflection. Items contain validated draft payloads, evidence links, and order. Applying a Proposal records exact Operation receipts in the same transaction.

## Notes Domain

### `notes`

- `id`, `workspace_id`, optional `parent_note_id`
- `title`, canonical normalized `body_markdown`
- `sort_key`, `ai_excluded boolean`, `version bigint`
- `created_at`, `updated_at`, `archived_at`, `trashed_at`, `purge_after`

The model permits arbitrary depth; the UI is optimized for six levels. A Note has one parent but can have many typed links.

### `note_revisions`

Immutable prior Markdown plus author/surface, source Operation, and timestamp. Autosave coalescing prevents a revision per keystroke.

### `tags` and `note_tags`

- Tags are Workspace-scoped and normalized for uniqueness.
- `note_tags` uses composite Workspace foreign keys to both records.

### Explicit planning and knowledge relations

- `note_links` connects source and target Notes and carries a relation type.
- `note_goal_links` connects Notes and Goals.
- `note_action_links` connects Notes and Actions.
- `capture_note_links` records a reviewed Capture filed into a Note without changing the Capture.
- Review-to-Goal and Review-to-Action snapshot tables preserve what a completed Review evaluated.

Each junction carries `workspace_id`, composite foreign keys to both endpoints, and a uniqueness constraint appropriate to the relationship. Backlinks are reverse queries over these tables, not duplicated rows. Additional endpoint combinations require a migration rather than an unconstrained polymorphic record.

### `attachments`

- `id`, `workspace_id`, `note_id`
- private Storage object key, original display name, detected media type, byte size, checksum
- malware state, created timestamp, Trash fields

Storage paths are generated identifiers, not user filenames. Download is authenticated or uses a short-lived signed URL.

## Review, Memory, And Assistant Domain

### `reviews`

- `id`, `workspace_id`, `horizon_id`
- `kind`: `daily`, `weekly`, `monthly`, or `quarterly`
- `status`: `draft` or `completed`
- Markdown reflection, completion timestamp, and version
- immutable links to reviewed Actions and scheduling decisions

### `memories`

Explicit user-editable preferences, constraints, or recurring facts with source, status, version, and Trash fields. AI creates only a Proposal for Memory changes.

### `assistant_profiles`

One row per Workspace for explicit tone, coaching intensity, interaction preferences, and version. It contains user choices only; inferred facts belong in proposed Memory and are never written here silently.

### Assistant runtime state

Planner AI stores durable Conversations, Messages, Proposals, and explicit Memory in the same Supabase trust boundary under Workspace ownership and forced RLS. There is no Agent Native framework database in the first release. The assistant reaches domain data only through versioned Operations; chat history never becomes a second source of truth for Goals, Actions, Notes, Captures, or Memory.

## Operations, Approval, And Activity

### `operation_receipts`

- stable Operation ID and major version
- Workspace, actor ID/type, surface, request/idempotency key
- risk class, target references, status, timestamps, stable error code
- unique `(workspace_id, operation_id, idempotency_key)` where applicable

### `approval_requests`

Exact proposed effects, requesting actor/surface, expiry, approved/denied state, and approving user. Approval applies to one payload hash and cannot authorize a changed request.

### `activity_events`

Append-only, user-visible records for durable writes and sensitive/consequential reads. Store actor, surface, Operation, target, risk/approval, timestamp, and outcome. Inputs and personal content are omitted or redacted by default.

### `ai_jobs`

Durable status for transcription, structured analysis, embeddings, and long-running agent work. Includes source reference, capability role, provider class, retry count, budget usage, timestamps, and content-free failure code.

### `lifecycle_jobs`

Durable export, purge, backup-verification, and account-deletion coordination state. Jobs use idempotency keys, explicit legal/retention holds where applicable, bounded retries, and content-free failure codes.

### `lifecycle_job_runs`

Content-free execution evidence for privileged scheduled work. Each run records only the job name, start/finish timestamps, bounded counters, final status, and a stable failure code. It is service-role-only: no browser or ordinary server request can read or alter it. This complements platform logs and gives Planner AI a durable, queryable checkpoint for notification delivery, account deletion, and attachment retention jobs.

## Integrations And Notifications

- `beta_invites`: server-administered hashed invite token, intended email where applicable, expiry, use count, and revocation. Signup consumes an invite atomically.
- `oauth_grants`: referenced grant metadata, scopes, audience, expiry, revocation, and offline-access state.
- `automation_grants`: explicit Operation allowlist and risk ceiling per automation.
- `connection_secrets`: server-only encrypted ciphertext, key version, provider, purpose, destination binding, owner, rotation, and revocation metadata; ciphertext is never returned through ordinary domain APIs.
- `support_access_grants`: user-selected diagnostic scope, purpose, approver, operator, expiry, revocation, and Activity references. There is no standing content grant.
- `notifications`: in-app delivery state and source.
- `notification_preferences`: timezone, quiet hours, in-app/email choices.
- Post-beta Calendar link tables preserve provider, calendar ID, event ID, sync token/state, and linked Action without merging the two concepts.

Raw OAuth refresh tokens are not stored in ordinary domain columns. They use the approved encrypted connection vault.

## Database Security

- RLS is enabled and forced where supported on every exposed domain table.
- Separate policies exist for `SELECT`, `INSERT`, `UPDATE`, and `DELETE`; both `USING` and `WITH CHECK` are explicit.
- Anonymous users have no domain-table privileges.
- Parent-child ownership is enforced by composite foreign keys, not only application checks.
- The web Operation service uses a restricted, non-`BYPASSRLS` server role and a transaction-local verified actor context.
- The Supabase service-role key is unavailable to browser code, Agent Native, AI providers, and ordinary request handlers. It is reserved for isolated lifecycle/admin jobs.
- Security-definer functions set a fixed `search_path`, have minimum grants, and receive dedicated tests.

## Migration From The Prototype

1. Capture a remote schema dump, row counts, checksums, and encrypted backup before changes.
2. Create canonical tables beside legacy tables through versioned Supabase migrations.
3. Enter a short maintenance window; do not build a fragile dual-write system for the small prototype dataset.
4. Transform `visions` into Vision, yearly/quarterly rows into Goals, monthly/weekly rows into Actions, and `transcripts` into Captures while preserving IDs or explicit legacy mappings.
5. Validate ownership, counts, relationships, raw text, status mapping, and time boundaries.
6. Switch reads and writes behind a release flag; run critical-path tests and rollback rehearsal.
7. Keep legacy tables read-only for 30 days, then remove them through a separate reviewed migration after backup retention and verification.

## Migration Definition Of Done

- A clean environment builds from zero with one command.
- Production schema drift is detected in CI/deploy checks.
- Every RLS policy has positive and cross-user negative tests.
- Migration and rollback are tested against a sanitized production-shaped snapshot.
- No manual SQL Editor step is required for normal deployment.
