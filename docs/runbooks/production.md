# Planner AI Production Runbook

Status: pre-beta working runbook, updated 2026-09-05. Evidence marked pending is a release blocker, not an assumed success.

## Ownership

| Domain                                               | Private-beta owner          | Escalation responsibility                              |
| ---------------------------------------------------- | --------------------------- | ------------------------------------------------------ |
| Product, release decision, support, privacy requests | Kaleb, product owner        | Approve release, user communication, and shutdown      |
| Web application, Operations, migrations, CI          | Kaleb, engineering owner    | Diagnose, rollback, and preserve evidence              |
| Supabase Auth, Postgres, Storage, backups            | Kaleb, infrastructure owner | Provider escalation, restore, key rotation             |
| Groq and optional OpenAI processing                  | Kaleb, AI provider owner    | Disable provider, enforce spend and retention controls |
| Resend and scheduled workers                         | Kaleb, notification owner   | Pause delivery, rotate sender credentials              |
| Independent security review                          | External reviewer, pending  | Report and retest critical/high findings               |

One person holds several roles during private beta. A second trained responder and current contact sheet are required before wider access.

## Service Objectives

- Core authenticated planning availability: 99.5% per calendar month, excluding announced maintenance.
- Ordinary successful Operation latency: p95 below 750 ms.
- Data recovery: RPO at most 24 hours and RTO at most four hours.
- AI and transcription are measured separately and never count as core availability.
- Raw operational events expire after 90 days and contain no prompts, record content, filenames, session replay, or secrets.

Alert when core 5xx responses exceed 2% for five minutes, p95 exceeds 1.5 seconds for 15 minutes, authentication failures exceed the recent baseline by 3x, a scheduled worker misses two intervals, a backup is older than 26 hours, provider failures exceed 20% for 10 minutes, or estimated provider spend reaches 80% of the hard cap.

## Scheduled Worker Evidence

The protected notification-delivery, account-deletion, and attachment-retention routes record only content-free execution evidence in `lifecycle_job_runs`: job name, status, timestamps, counters, and stable failure code. On every production check, inspect the latest completed row per job and correlate any failed or missing run with Vercel Cron and platform logs. A run that is still `running` after twice the normal execution duration is also an incident signal. Do not place Workspace content, attachment names, request bodies, credentials, or provider responses in this table or related alerts.

## Release Gate

1. Confirm the intended commit and a clean CI run for format, lint, types, unit, build, database, browser, dependency, and secret checks.
2. Identify a restorable remote database backup and separately verify private Storage backup.
3. Run migration preflight and drift detection; record row counts and schema version.
4. Apply migrations during the announced maintenance window, run every pgTAP suite, regenerate types, and rerun authenticated browser journeys.
5. Set `PLANNER_DATA_MODEL=canonical` only after database and rollback checks pass.
6. Verify SMTP, Google OAuth, MFA, Supabase OAuth Server, provider retention/model/spend controls, worker schedules, production domains, telemetry, and alerts.
7. Run the AI outage drill, restore drill, keyboard/screen-reader/zoom checks, and independent security review.
8. Product owner records a go/no-go decision. Any missing P0 evidence is no-go.

## Database Cutover And Rollback

Before cutover, export a logical backup, record table counts, inspect migration drift, and verify the backup can be read. Apply only files in `web/supabase/migrations` in order; never reconstruct schema from historical prototype SQL or dashboard copy/paste. Run `npm run test:db`, regenerate `src/types/supabase.generated.ts`, and compare post-migration counts and ownership checks.

When managed Supabase backups are unavailable, create a gitignored `web/.env.release.local` file and use the guarded local command from `web` to create an encrypted logical backup before a cutover:

```bash
SUPABASE_ACCESS_TOKEN='<personal-access-token>'
PLANNER_PRODUCTION_DATABASE_URL='postgresql://postgres.<project-ref>:<database-password>@aws-<region>.pooler.supabase.com:5432/postgres'
PLANNER_BACKUP_PASSPHRASE='<long-unique-offline-passphrase>'

# Then, from web/:
npm run preflight:production-cutover
npm run backup:production-db
```

The read-only preflight requires all three credentials, confirms the production database connection string belongs to the linked project, and fails on migration-history drift. It does not repair migration history, create a backup, or mutate the hosted project. The personal access token authorizes Supabase management/CLI work; the backup command itself uses the direct database URL and passphrase. It writes an encrypted, checksum-addressed archive under the gitignored `web/backups/` directory and verifies the unencrypted dump before encryption. Store the archive and passphrase separately, copy the archive to an owned encrypted location, then prove it remains readable with `npm run verify:production-backup -- backups/<archive>.dump.enc`. Never paste any value into tracked source, browser forms, chat, CI logs, or `NEXT_PUBLIC_` variables.

Before a production cutover, prove the database portion can be recovered into a disposable local Supabase Postgres instance:

```bash
# From web/; Docker must be running.
npm run restore-drill:production-db -- backups/<archive>.dump.enc
```

The drill validates the encrypted archive checksum when present, decrypts only to a mode-restricted temporary file, waits through the Supabase image initialization restart, restores with `pg_restore --exit-on-error`, verifies that public tables exist and all use RLS, and destroys the container and plaintext archive. It does not contact production. A hosted recovery-project drill is still required before invite beta because the local drill does not test Storage objects, Auth delivery suppression, networking, or managed-platform configuration.

If validation fails, stop writes, return the deployment to `PLANNER_DATA_MODEL=legacy`, preserve database and application logs, and restore the preflight backup into a separate recovery project first. Do not overwrite the failed database until the recovery copy passes counts, RLS checks, and authenticated smoke tests.

## Incident Response

| Severity | Definition                                                                               | Initial action                                                                                           |
| -------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| SEV-1    | Cross-Workspace access, secret exposure, destructive corruption, or complete core outage | Contain immediately, disable affected path, rotate credentials, preserve evidence, notify affected users |
| SEV-2    | Material feature outage, auth degradation, failed worker, or sustained SLO breach        | Mitigate within one hour, publish status, open provider escalation                                       |
| SEV-3    | Limited defect with a workaround and no security or data-loss impact                     | Triage next business day and schedule a tested fix                                                       |

Never browse private Workspace content for diagnosis. Start with request IDs, Operation IDs, result class, latency, provider class, and pseudonymous identity. Any exceptional content access must be user-initiated, purpose-bound, time-limited, logged, and revoked automatically.

## Provider Outage Drill

1. Disable or invalidate the AI provider in a staging deployment.
2. Verify assistant, Goal analysis, Review analysis, and transcription return stable retryable errors without provider details.
3. Verify click-first planning, Notes, exact search, raw Capture creation, export, and authentication remain available.
4. Verify failed source input remains intact and retry does not duplicate a Conversation message or publish a stale analysis job.
5. Re-enable only an evaluated provider/model; record timestamps, screenshots, request IDs, and results.

## Backup And Restore Drill

Quarterly and before beta, restore the latest Postgres backup and private Storage copy into an isolated project. Verify identities are not accidentally notified, then compare Workspace and lifecycle counts, sample checksums, attachment object counts, RLS isolation, Operations, export, Trash, account deletion, and signed downloads. Record actual RPO/RTO and destroy the isolated copy after evidence retention requirements are met.

## Shutdown And Rotation

- AI incident: clear provider keys or disable Workspace AI processing; never disable core planning.
- MCP incident: revoke the affected grant/token; for broad exposure disable the MCP route and rotate signing/client secrets.
- Notification incident: remove `CRON_SECRET` from the scheduler or disable the schedule, then rotate Resend credentials if needed.
- Supabase service-role exposure: rotate immediately, redeploy every trusted worker, inspect Activity/auth logs, and treat as SEV-1.
- User-requested deletion: preserve the seven-day cancellation window; do not manually bypass the audited worker.

## Evidence Log

| Evidence                                 | State   | Last result                                                                                                                                                                                                   |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote database backup and restore       | Partial | Encrypted logical backup and local isolated Supabase restore passed again on 2026-09-07: 55 public tables, all 55 with RLS, and 128 public functions; off-machine custody and hosted recovery-project drill remain open |
| Private Storage backup and restore       | Pending | Private attachment intake, recovery window, and purge path exist; production backup custody and a restore drill remain open                                                        |
| Canonical migrations and pgTAP           | Partial | Migration history and guarded preflight remain aligned through `20260906114500`; fresh backup and local pgTAP pass, while two later local Notes-vault migrations await a recorded cutover window and deployed canonical journeys remain to be verified |
| Vercel application release               | Partial | Commit `1d570e4` built successfully; the team-scoped production alias is behind Vercel Authentication and `planner-ai.vercel.app` still resolves to the unrelated legacy Telegram-bot site                  |
| Authenticated canonical browser journeys | Pending | Requires canonical test environment                                                                                                                                                                           |
| Provider outage drill                    | Pending | Deterministic degradation tests pass                                                                                                                                                                          |
| Independent security review              | Pending | Reviewer not assigned                                                                                                                                                                                         |
| Production alerts and schedules          | Pending | Infrastructure not connected                                                                                                                                                                                  |
