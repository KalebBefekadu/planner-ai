# Planner AI Product Requirements

Status: **Approved first-release PRD.** Product language comes from [`CONTEXT.md`](../../CONTEXT.md); architecture and delivery details come from the [architecture](../engineering/architecture.md) and [roadmap](../roadmap.md).

## 1. Product Definition

Planner AI is a private, voice-first planning and knowledge Workspace for adults. It connects long-term Vision to outcome-oriented Goals, concrete Actions, Notes, Captures, and recurring Review. The click-first product is complete without chat; the assistant is a second, contextual way to perform the same authorized Operations.

## 2. Primary User

The first release serves an individual who:

- wants one private system for planning, reflection, and personal Notes;
- regularly captures thoughts by voice or typing;
- needs help turning unstructured input into deliberate work;
- wants AI assistance without surrendering ownership, review, or portability;
- uses desktop and mobile browsers but does not need team collaboration.

Each Workspace has one owner. The platform may have many registered users, but there are no shared Workspaces in the first release.

## 3. Product Outcomes

The product succeeds when a person can repeatedly:

1. capture a thought without losing or pre-structuring it;
2. see a small set of current priorities connected to meaningful outcomes;
3. organize Notes and planning material in one searchable place;
4. complete Weekly Review without silent rollover;
5. ask the assistant to perform the same safe actions available in the interface;
6. understand, undo, export, or delete what AI and external agents changed.

## 4. First-Release Surfaces

### Today

- Show at most three highlighted daily priorities, overdue Actions, Goal context, recent Captures, and the next Review.
- Allow completion, rescheduling, blocker, and replacement decisions without opening chat.
- Keep ordinary screens quiet; proactive coaching appears only at decision points.

### Plan

- Maintain one Vision.
- Create yearly and quarterly Goals with optional outcome metrics.
- Create monthly and weekly Actions connected to Goals or Notes.
- Preserve Planning Horizon and scheduling history.
- Highlight at most five committed weekly Actions without blocking creation elsewhere.

### Notes

- Provide one hierarchy, tags, internal links/backlinks, and planning relationships.
- Store normalized Markdown canonically and support the accepted rich-Markdown subset.
- Autosave safely, preserve revisions, support restore, and allow per-Note AI Exclusion.
- Support restricted private attachments before external beta.
- Search exact content and metadata with direct links to source records.

### Capture Inbox

- Accept typed and browser-recorded voice input.
- Preserve raw text exactly and separately from AI interpretation.
- Keep failed encrypted audio for at most seven days; delete successful audio after transcription.
- Use `new`, `proposed`, `reviewed`, and `archived` states.
- Preserve unsent mobile Capture input through interruption and network loss.

### Review

- Make Weekly Review the primary workflow.
- Require a deliberate decision for unfinished Actions: reschedule, reduce, block, drop with reason, or leave overdue.
- Offer optional Monthly and Quarterly summaries.
- Preserve completed Review and Action scheduling history.

### Assistant

- Render as a collapsible dock inside the Planner AI product.
- Understand minimal page/selection context and retrieve additional authorized sources only as needed.
- Perform Operations with the same validation, authorization, risk, undo, and Activity behavior as UI.
- Show sources and label output as supported, inferred, or needing input.
- Provide durable user-controlled Conversations without silently creating Notes or Memory.

### Settings, Privacy, And Activity

- Manage authentication identities, TOTP MFA, timezone, week start, coaching intensity, notification preferences, AI usage, Memory, AI Exclusions, MCP grants, automations, export, Trash, and account deletion.
- Show Activity for durable writes and sensitive/consequential reads.
- Explain provider use, retention, encryption boundary, and data deletion plainly.

## 5. Functional Requirements

| ID     | Requirement                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-001 | Verified email/password and Google OAuth work without duplicate accounts; invite-only signup is enforced server-side.                                                    |
| FR-002 | Every page and Operation verifies the user and Workspace; unauthenticated users cannot see product chrome or data.                                                       |
| FR-003 | TOTP MFA is optional for login and required at `aal2` for identity changes, offline MCP, full export, and account deletion.                                              |
| FR-004 | Every durable write uses one versioned Operation service and creates an Activity receipt atomically.                                                                     |
| FR-005 | Immediate, reversible, consequential, and prohibited risk classes determine execution and approval behavior.                                                             |
| FR-006 | UI and assistant paths have behavioral parity for every exposed feature.                                                                                                 |
| FR-007 | Raw Captures remain immutable; AI processing produces versioned reviewable Proposals.                                                                                    |
| FR-008 | Goal Progress reflects outcomes or user assessment, never only completed Action percentage.                                                                              |
| FR-009 | Review never silently rolls unfinished Actions forward.                                                                                                                  |
| FR-010 | Notes round-trip the supported Markdown subset without content loss.                                                                                                     |
| FR-011 | Notion Markdown/CSV and Obsidian folder/ZIP imports provide a dry run, duplicate plan, unsupported-content report, and resumable commit.                                 |
| FR-012 | Full export includes domain data, Markdown Notes, attachments, Memories, Conversations, Activity, and grants in documented formats.                                      |
| FR-013 | Records remain recoverable in Trash for 30 days; account deletion has a seven-day cancellation window.                                                                   |
| FR-014 | First-release notifications are in-app plus explicitly scheduled transactional email.                                                                                    |
| FR-015 | Search begins with exact per-Workspace PostgreSQL full-text search and visible source links.                                                                             |
| FR-016 | External MCP uses per-user OAuth, read by default, explicit write, optional offline access, revocation, versioning, and Activity.                                        |
| FR-017 | Automations are visible, cancellable, and more narrowly authorized than interactive chat.                                                                                |
| FR-018 | Assistant Profile and Memory are explicit, independently editable, and reversible.                                                                                       |
| FR-019 | AI Exclusion prevents retrieval by chat, automation, and external MCP unless the user explicitly includes the Note for one interaction.                                  |
| FR-020 | Production code execution, arbitrary extensions, executable skills, repository access, shell, and arbitrary outbound MCP are unavailable.                                |
| FR-021 | Support has no standing private-content access or impersonation; exceptional diagnostic access is user-scoped, time-bound, approved, revocable, and visible in Activity. |
| FR-022 | OAuth and provider secrets remain purpose-bound, rotatable, server-side encrypted, and unavailable to browsers, models, logs, Activity, and ordinary support tools.      |
| FR-023 | Imported, retrieved, attached, and external content is treated as untrusted data and cannot grant authority, change destinations, or bypass approvals.                   |
| FR-024 | Planner AI identifies itself as adult planning software and does not claim medical, legal, financial, diagnostic, or crisis-service authority.                           |

## 6. AI Requirements

- Provider roles are `agent`, `structured-analysis`, `transcription`, and `retrieval`.
- Only approved paid/enterprise API paths with documented no-training and retention terms may process production content.
- Context is minimized and provenance is preserved.
- Structured outputs are schema-validated and invalid output has no effect.
- Expensive calls have explicit limits and user confirmation when unusual.
- AI failures preserve input, expose status and retry, and never disable click-first planning.
- Imported or external content is untrusted data and cannot alter authority, recipients, destinations, scopes, or approval policy.
- Planner AI does not expose hidden chain-of-thought or raw internal prompts.
- Coaching avoids coercion, shame, diagnosis, and claims of medical, legal, financial, or crisis expertise.

## 7. Nonfunctional Requirements

| ID      | Requirement                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-001 | Core authenticated Operations target 99.5 percent monthly beta availability, excluding announced maintenance.                                         |
| NFR-002 | Ordinary core Operations target p95 below 750 ms under the documented beta load profile.                                                              |
| NFR-003 | A successful write response means domain data and Activity are durably committed.                                                                     |
| NFR-004 | Idempotent retry prevents duplicate writes; optimistic concurrency prevents silent overwrite.                                                         |
| NFR-005 | Core workflows meet WCAG 2.2 AA with automated and manual verification.                                                                               |
| NFR-006 | The responsive PWA supports touch, install, update, browser voice Capture, and unsent-Capture recovery.                                               |
| NFR-007 | No personal content, prompts, filenames, or secrets enter logs, analytics, or error responses.                                                        |
| NFR-008 | Database and Storage recovery meet initial 24-hour RPO and four-hour RTO in a real drill.                                                             |
| NFR-009 | All exposed tables have RLS and cross-user negative tests; linked records cannot cross Workspaces.                                                    |
| NFR-010 | Every external Operation version has a migration/deprecation policy and compatibility tests.                                                          |
| NFR-011 | Multi-record domain changes and their Activity receipt commit in one database transaction or have no effect.                                          |
| NFR-012 | CI pins the runtime and package manager and blocks secret leaks, dependency-policy failures, schema drift, migration drift, and generated-type drift. |

## 8. Onboarding

Onboarding is skippable and targets one real planning loop in about ten minutes:

1. verify time settings and explain privacy/AI controls;
2. optionally draft Vision;
3. create one Goal and one Action;
4. make one typed or voice Capture;
5. schedule Weekly Review;
6. optionally branch to Notion or Obsidian import.

Microphone permission is requested only after the person initiates voice Capture. Incomplete onboarding never blocks the empty Workspace.

## 9. Launch Scope

### Required before invite beta

- stable authentication, custom SMTP, Google OAuth, invite gating, and MFA step-up;
- Today, Plan, Notes, Capture, Review, Settings, and Activity through UI;
- embedded assistant with safe read/write parity for critical workflows;
- exact search, attachments, dry-run import, full export, Trash/deletion;
- tested backups and restore, monitoring, security review, and no open severity-one defects;
- responsive PWA and WCAG 2.2 AA core flows;
- small inbound MCP surface and narrowly granted automations only when their gates pass.
- least-privilege support operations, user-visible Activity, secret rotation, incident runbooks, and named operational ownership.

### Deferred

- billing, public signup, collaboration, teams, sharing, comments, and public pages;
- native mobile or desktop wrappers and full offline editing;
- local-first or writable filesystem sync;
- advanced Note databases, executable MDX, and live Notion sync;
- outbound MCP, generated extensions, custom executable skills, and agent code execution;
- Calendar integration until four reliable invite-beta weeks; Calendar writes follow trusted read behavior;
- habit streaks, broad messaging integrations, semantic retrieval as the only search path, and arbitrary custom planning hierarchies.

## 10. Product Success And Guardrails

Invite-beta expansion requires:

- four consecutive weeks within the core reliability objective;
- successful restore, migration rollback, AI-outage, and security reviews;
- repeated completion of Capture, Today, Notes, and Weekly Review workflows;
- evidence that AI Proposals are accepted or corrected for useful reasons rather than blindly applied;
- support volume and AI cost within documented budgets;
- no unresolved cross-user access, data-loss, secret-exposure, or unauthorized-effect incident.

No-bug software is not a credible promise. The release standard is no known severity-one defect, explicit residual risk, fast rollback, protected input, strong automated coverage, and observable failure behavior.
