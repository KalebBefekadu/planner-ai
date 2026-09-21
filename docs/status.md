# Planner AI Status

Updated: 2026-09-20

## Current State

Planner AI has a mature, tested application foundation but is not yet production-ready. The immediate goal is a private deployment the owner can use every day instead of Notion for personal notes and planning.

The earlier 78/55/27 percent estimates had no documented weighting and are not release evidence. Track implemented, locally verified, deployed verified and owner-accepted gates in the [build manual](build-manual.md) and its linked GitHub issues.

Owner decision, 2026-09-20: the representative Notion pilot is removed from the current program. Import remains implemented, but this release will not claim complete Notion replacement. Declarative schemas, live tracing/SLO certification, and external MCP certification are deferred until after personal dogfood.

## Verified Foundation

- Authenticated owner-isolated workspaces, canonical relational data, RLS, versioned Operations, Activity, and undo.
- Capture, voice transcription, atomic AI proposals, Today, Vision, Goals, Actions, Calendar, and weekly/monthly/quarterly Review.
- Hierarchical Markdown Notes with autosave, search, backlinks, history, reordering, reparenting, attachments, Trash, export, and loss-aware import/restore.
- Governed assistant behavior, durable Conversations and Memory, AI Exclusion, schema-constrained GenUI, and scoped MCP foundations.
- One Preview-inspired authenticated shell across Workspace and Planner, including responsive navigation and accessible interaction states.
- Production-build browser coverage for canonical desktop and mobile journeys, plus unit, database, type, lint, formatting, build, and dependency-audit gates.
- Editable life areas with subareas, one canonical Note page each, per-area
  directions, inherited archive and AI exclusion, and an association between a
  part of life and the Goals, Actions and Notes filed under it.
- A weekly worksheet with a frozen baseline and a closed-week record, so
  "planned tasks completed" has a denominator that later edits cannot move.
- Goals that outlast the quarter they started in, read through Quarter and Year
  views without being cloned into each period.
- Routines whose frequency is a target the week counts, rather than appointments
  nobody made; a second press on the same day is the same session.
- A deadline that is a separate fact from the day work is planned for, so
  rescheduling the work does not move what was promised.
- Projects: a finite body of work that cannot be stored without saying what
  finishing it means, can span the turn of a year, and can be reopened after
  being called done.
- The full Workspace export now carries life areas, projects, weekly plans and
  their baselines. It carried none of them before, so a restore would have
  returned the work without the parts of life it was filed under.
- "Break this down" on a dated Goal, which previously refused anything but an
  ongoing initiative. It declines a goal whose date has passed rather than
  quietly rescheduling it.
- Suggestions for today and for the week, drawn only from work that already
  exists. The model answers with list positions rather than identifiers, so it
  cannot name work that is not there, and neither suggestion writes anything
  until an explicit press applies it through the same Operations the manual
  controls use.
- "What has gone quiet", answered from dates rather than by a model, asked for
  rather than shown, and explicit that it measures what was written down.

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

### The life-areas redesign is partial, by design and not by accident

Verified on `claude/life-areas-redesign`: 79 pgTAP suites at 1,526 assertions,
1,126 unit tests across 98 files, and the production-build browser suite,
including new journeys for life areas, the compacted planner, title-first Today,
the weekly worksheet, routines counted against a frequency target, and a
deadline that survives the work being rescheduled.

Not built, and not to be read into the above: related-area links, deferred
deliberately -- one primary area, with the association contract isolated so
equal membership stays adoptable. Four Operations are withheld from agents for
prompt budget rather than principle, which is a ceiling the assistant catalog
has now reached rather than a decision anyone made.

One dependency is refused rather than handled: an area's canonical page cannot
be moved to Trash while the area uses it. A database trigger enforces that on
every path, and `area.replace-note.v1` is the way out. Notes has no trash
control today, so there is no screen the refusal appears on yet; the message
is written for the day one arrives.

### Personal dogfood

- Complete and verify the real direction-to-action loop, including deferral and weekly-review continuity.
- Finish authenticated Workspace and Planner parity. `/preview` itself stays: its six deferred screens are gone and their design is preserved, and the six patterns still behind it are unbuilt MVP features tracked under WS-01 through WS-04. See the Preview Policy in the roadmap for why that is an accepted cost rather than an open task.
- Certify embedded-assistant parity for critical Note and Planner Operations, including useful provider-failure behavior.
- Apply pending production migrations during an approved maintenance window and run authenticated deployed smoke tests.
- Complete seven consecutive days of daily use and resolve workflow-blocking defects.

### Release operations

- Refresh the protected production database connection credential, create a fresh encrypted backup, rehearse it, then apply the seven additive migrations from `20260915090000` through `20260915150000` in a recorded maintenance window.
- Verify Vercel production environment, deployment protection, owned domain, SMTP, cron ownership, external alerts, and canonical application mode.
- Establish off-machine backup custody and prove a hosted recovery drill covering Auth, Storage, and managed configuration.

### Deferred until after personal dogfood

- Introduce declarative database schemas.
- Verify one external AI client through narrow authenticated MCP discovery, grants, execution, and revocation.
- Complete production tracing/SLO certification using live traffic.

### Later beta gates

- Complete broader live-provider certification, production budgets, and retention review.
- Complete additional OAuth MCP host compatibility and independent security review.
- Add malware scanning before exposing quarantined Note attachments.
- Record manual keyboard/screen-reader, load/SLO, restore, rollback, and incident-drill evidence.

Graph, Canvas, databases, collaboration, plugins, stronger local-first sync, and broad MCP writes remain after personal dogfood and are not current blockers.

## Current Decision

Follow [Roadmap](roadmap.md) with one active ticket at a time. Preserve canonical data and Operations, keep core workflows usable without AI, and treat `/preview` as a reference for patterns that are not built yet rather than a second product. Production changes, credentials, billing, and destructive migrations remain explicit approval gates.

## Release Rule

Do not call the product production-ready until persistence, authentication, recovery, provider behavior, security, accessibility, and critical journeys have been observed in the deployed environment. Local implementation is evidence, not a substitute for production verification.
