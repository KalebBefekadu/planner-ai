# Planner AI Status

Updated: 2026-09-10

## Current State

Planner AI has a mature, tested application foundation but is not yet production-ready. The immediate goal is a private deployment the owner can use every day instead of Notion for personal notes and planning.

The earlier 78/55/27 percent estimates had no documented weighting and are not release evidence. Track implemented, locally verified, deployed verified and owner-accepted gates in the [build manual](build-manual.md) and its linked GitHub issues.

The owner's actual Notion workflow inventory remains open. Notes import alone cannot establish replacement of required databases, relations, formulas, attachments or sharing.

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

### The application served its first page, 2026-09-10

No deployment of this application had ever served a page. Three stacked faults had to clear, none of them in application code:

- Vercel had no Root Directory, so every deployment in the project's history built the repository root, detected no framework in 456ms, and served loose repository files as `404: NOT_FOUND`. Setting it to `web` was necessary and not sufficient.
- The Framework Preset was still `Other`, so the build served `web/public/` as a static folder. That folder holds the Note cover images and no `index.html`, so the result was another 404. The fix is `"framework": "nextjs"` in `web/vercel.json`, held in version control rather than dashboard state, so a project re-import cannot silently lose it again.
- The project had no Production environment variables, so the first build that actually ran the application returned `Internal Server Error`. Six values are now set.

The production database was then found to be 17 migrations behind the deployed code. That is why `/notes` alone failed while every other route rendered: `getFavoriteNotes` filters on `notes.favorited_at`, added by `20260909200000_note_favorites`, and production's last applied migration was `20260906150453`. The page itself reported only a digest, because a production build redacts Server Component error messages, so the cause was read from the Vercel runtime log rather than from the browser. A digest is not a diagnosis, and this is the second time that redaction has hidden a real cause.

Before applying anything, schema, data and auth dumps were taken and checksummed, restored into a throwaway database that reproduced production exactly at 55 tables and 128 functions, and all 17 migrations were applied there first. That rehearsal changed no rows and left RLS enabled on every table. Production is now in sync at 79 of 79 migrations, 56 tables, 137 functions.

Verified against the deployed application afterwards, signed in as the owner:

- Thirteen authenticated routes render with no Server Component errors in the runtime log.
- `/notes` loads a real Note in both the tree and the editor.
- A thought typed into the shell composer saved without navigating, reported that it was captured, and was read back from `/inbox` on a later request.

Still open: these journeys are hand-verified rather than run as a suite against production, off-machine backup custody is unproven, and the `service_role` key needs rotating.

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
