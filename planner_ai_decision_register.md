# Planner AI Decision Register

This register is the closed pre-implementation decision baseline plus explicit implementation-era supersessions. D-057 records the Agent Native feasibility result and controls wherever it conflicts with D-003, D-035, or D-056.

## Accepted Decisions

| ID | Decision | Status | Record |
| --- | --- | --- | --- |
| D-001 | Vision is direction, Goals are yearly/quarterly outcomes, Actions are monthly/weekly work, and Planning Horizons are time boundaries. | Accepted | `CONTEXT.md` |
| D-002 | Supabase is the authoritative source of truth for the first legitimate release. | Accepted | `docs/adr/0001-supabase-source-of-truth-for-first-release.md` |
| D-003 | The Next.js `web` app remains the product; Agent Native is embedded as a docked sidecar. | Superseded by D-057 | `docs/adr/0024-adapt-agent-native-capabilities-without-shipping-its-runtime.md` |
| D-004 | Production agents control product Operations but cannot modify code, secrets, auth policy, deployments, or infrastructure. | Accepted | `docs/adr/0003-limit-production-agent-authority.md` |
| D-005 | Operations use immediate, reversible, consequential, and prohibited risk classes. | Accepted | `docs/adr/0004-use-risk-based-agent-approvals.md` |
| D-006 | First-release Workspaces are private and single-owner. | Accepted | `docs/adr/0005-use-single-owner-workspaces-for-first-release.md` |
| D-007 | Markdown in Supabase is the canonical Note format. | Accepted | `docs/adr/0006-store-notes-as-markdown-in-supabase.md` |
| D-008 | The first editor supports rich Markdown and defers executable or collaborative features. | Accepted | `docs/adr/0006-store-notes-as-markdown-in-supabase.md` |
| D-009 | Raw transcripts persist; successful audio is deleted and failed audio expires after seven days. | Accepted | `docs/adr/0007-use-explicit-personal-data-retention.md` |
| D-010 | Time uses UTC storage, a Workspace timezone, calendar periods, and Monday-start weeks by default. | Accepted | Product Direction and Roadmap |
| D-011 | Goal Progress measures outcomes rather than completed Actions. | Accepted | `CONTEXT.md` |
| D-012 | Agent Memory is explicit, editable, reversible, and never inferred silently from all user content. | Accepted | `docs/adr/0007-use-explicit-personal-data-retention.md` |
| D-013 | AI work is routed through provider-independent capability roles. | Accepted | `docs/adr/0008-route-ai-work-by-capability.md` |
| D-014 | External MCP uses per-user OAuth with read access by default and explicit grants. | Accepted | `docs/adr/0009-use-oauth-and-narrow-automation-grants.md` |
| D-015 | Automations use a narrower unattended allowlist and wait for consequential approvals. | Accepted | `docs/adr/0009-use-oauth-and-narrow-automation-grants.md` |
| D-016 | The first release is online-first but preserves unsent Captures locally. | Accepted | Product Direction and Roadmap |
| D-017 | AI processing creates reviewable Proposals without changing raw Captures. | Accepted | `docs/adr/0010-separate-captures-from-ai-proposals.md` |
| D-018 | Today highlights three daily and Review highlights five weekly priorities without blocking creation. | Accepted | Product Direction and Roadmap |
| D-019 | Simple recurring Action templates are supported; general habit tracking is deferred. | Accepted | Product Direction and Roadmap |
| D-020 | Unfinished Actions never roll over silently and retain their scheduling history. | Accepted | `CONTEXT.md` and Product Direction |
| D-021 | Weekly Review is primary; daily check-in is light; Monthly and Quarterly Reviews are optional templates. | Accepted | `CONTEXT.md` and Product Direction |
| D-022 | Coaching appears at decision points with calm, direct, or strict intensity. | Accepted | Product Direction and Roadmap |
| D-023 | First-release notifications are in-app plus explicitly scheduled transactional email. | Accepted | Product Direction and Roadmap |
| D-024 | Search starts with per-user Postgres full-text search; evaluated semantic retrieval follows later. | Accepted | Product Direction and Roadmap |
| D-025 | Notes use one hierarchy plus lightweight tags and typed links/backlinks. | Accepted | Product Direction and Roadmap |
| D-026 | Dry-run Notion and Obsidian import is required before beta; live sync is deferred. | Accepted | Product Direction and Roadmap |
| D-027 | Authentication uses verified email/password and Google OAuth first. | Accepted | `docs/adr/0011-use-verified-authentication-and-step-up-mfa.md` |
| D-028 | TOTP MFA is optional for beta login but `aal2` is required for sensitive account Operations. | Accepted | `docs/adr/0011-use-verified-authentication-and-step-up-mfa.md` |
| D-029 | First-release content is server-readable under explicit encryption and AI-processing boundaries, not end-to-end encrypted. | Accepted | `docs/adr/0012-protect-and-recover-user-data.md` |
| D-030 | Records use 30-day Trash and account deletion uses a seven-day cancellation window. | Accepted | `docs/adr/0012-protect-and-recover-user-data.md` |
| D-031 | External beta requires paid daily backups, separate Storage backup, and tested recovery targets. | Accepted | `docs/adr/0012-protect-and-recover-user-data.md` |
| D-032 | Note attachments use restricted private Storage with complete lifecycle coverage. | Accepted | `docs/adr/0012-protect-and-recover-user-data.md` |
| D-033 | Operational telemetry is content-free and product analytics is opt-in during beta. | Accepted | `docs/adr/0013-keep-the-core-reliable-without-ai.md` |
| D-034 | Core planning has a separate reliability objective and remains usable through AI-provider failures. | Accepted | `docs/adr/0013-keep-the-core-reliable-without-ai.md` |
| D-035 | Agent Native runs separately with its own persistent database and never owns Planner AI domain records. | Superseded by D-057 | `docs/adr/0024-adapt-agent-native-capabilities-without-shipping-its-runtime.md` |
| D-036 | Launch proceeds through dogfooding and free invite-only beta before billing. | Accepted | `docs/adr/0015-stage-beta-before-billing.md` |
| D-037 | Assistant turns begin with minimal context and retrieve only necessary authorized records. | Accepted | `docs/adr/0016-minimize-assistant-context-and-require-evidence.md` |
| D-038 | Conversations are durable but remain distinct from Notes, Captures, and Memory. | Accepted | `docs/adr/0016-minimize-assistant-context-and-require-evidence.md` |
| D-039 | Production AI providers must meet documented no-training and retention requirements. | Accepted | `docs/adr/0017-govern-ai-providers-and-managed-credentials.md` |
| D-040 | Invite beta uses managed AI credentials with visible usage and enforced cost limits. | Accepted | `docs/adr/0017-govern-ai-providers-and-managed-credentials.md` |
| D-041 | AI recommendations and changes cite exact evidence and label inference honestly. | Accepted | `docs/adr/0016-minimize-assistant-context-and-require-evidence.md` |
| D-042 | First-run onboarding is skippable and creates one real planning loop. | Accepted | Product Direction and Roadmap |
| D-043 | Actions and Calendar Events remain separate; calendar integration begins read-only after invite beta. | Accepted | `docs/adr/0018-separate-actions-from-calendar-events.md` |
| D-044 | The first mobile product is an installable responsive PWA rather than native clients. | Accepted | `docs/adr/0019-ship-a-pwa-before-native-mobile.md` |
| D-045 | Core workflows target WCAG 2.2 Level AA. | Accepted | Product Direction and Roadmap |
| D-046 | Exposed Operations use stable identifiers, versioned schemas, and compatibility windows. | Accepted | `docs/adr/0020-version-exposed-operation-contracts.md` |
| D-047 | The canonical domain uses workspace-scoped relational entities, not generic nodes or per-horizon tables. | Accepted | `docs/adr/0021-use-a-relational-domain-and-operation-service.md` |
| D-048 | Every durable write crosses one transport-neutral Operation service and transaction boundary. | Accepted | `docs/adr/0021-use-a-relational-domain-and-operation-service.md` |
| D-049 | Production code execution and arbitrary generated extensions are disabled for the first release. | Accepted | `docs/adr/0022-stage-agent-extensibility-behind-security-gates.md` |
| D-050 | Outbound MCP is deferred until after invite beta and limited to approved remote HTTP/OAuth servers. | Accepted | `docs/adr/0022-stage-agent-extensibility-behind-security-gates.md` |
| D-051 | Imported, retrieved, attached, and external content is untrusted data and never an instruction source. | Accepted | `docs/adr/0022-stage-agent-extensibility-behind-security-gates.md` |
| D-052 | Connection secrets stay encrypted server-side, domain-bound, revocable, and invisible to models and browsers. | Accepted | `docs/adr/0022-stage-agent-extensibility-behind-security-gates.md` |
| D-053 | Support has no standing content access or impersonation; diagnostics are user-initiated and time-limited. | Accepted | `docs/adr/0023-restrict-support-access-and-expose-activity.md` |
| D-054 | Users receive a content-free Activity trail for consequential reads and all durable writes. | Accepted | `docs/adr/0023-restrict-support-access-and-expose-activity.md` |
| D-055 | Planner AI is an adult personal-planning product, not a medical, legal, financial, or crisis service. | Accepted | Product Direction and Roadmap |
| D-056 | `web` is the product, a new minimal agent runtime is the sidecar, and `planner` plus the old SQL schema are reference artifacts only. | Superseded by D-057 | `docs/adr/0024-adapt-agent-native-capabilities-without-shipping-its-runtime.md` |
| D-057 | Adapt Agent Native capabilities into `web`; do not ship its runtime or a second application database in v1. | Accepted | `docs/adr/0024-adapt-agent-native-capabilities-without-shipping-its-runtime.md` |

## Accepted Batch 1: Core Product Behavior

Accepted together after review. The recommendations below are now requirements.

### D-007: Canonical Note Format

**Question:** What representation is authoritative for a Note?

**Recommendation:** Store normalized Markdown as the canonical Note body in Supabase. The editor may use Tiptap internally while open, but it must round-trip through the supported Markdown subset. Metadata such as owner, title, parent, position, timestamps, and relations stays in typed columns. Markdown files are export/sync surfaces, not another writable source of truth.

**Why:** This matches the Obsidian-style portability goal and Content's SQL-canonical approach while keeping search, permissions, history, and cross-device access dependable.

### D-008: First-Release Editor Scope

**Question:** How powerful should the first Notes editor be?

**Recommendation:** Support headings, paragraphs, bold/italic, lists, checklists, block quotes, links, code blocks, dividers, tables, and internal Note links. Defer arbitrary MDX components, executable code, databases, public publishing, comments, and collaborative cursors.

**Why:** This is enough to replace ordinary personal Notion and Obsidian usage without introducing executable-content security, collaboration, or database-view complexity before the core vault is reliable.

### D-009: Voice Audio Retention

**Question:** After successful transcription, should Planner AI retain the original audio?

**Recommendation:** Preserve the raw transcript permanently, but delete temporary audio immediately after successful transcription by default. If transcription fails, retain the encrypted upload for seven days so the user can retry or delete it. Add opt-in long-term audio retention later.

**Why:** The transcript is the durable user artifact. Default audio deletion materially reduces privacy exposure, storage cost, and data-export burden while preserving recovery from transient failures.

### D-010: Calendar And Planning Semantics

**Question:** How should Year, Quarter, Month, and Week boundaries work?

**Recommendation:** Store timestamps in UTC and store one IANA timezone on the Workspace. Use calendar years and quarters, calendar months, and Monday-start weeks for the first release. Let the user change timezone and week start; defer custom fiscal calendars.

**Why:** Planning must remain stable across devices and daylight-saving changes. Custom fiscal periods add substantial date, query, and UI complexity with little value for a personal first release.

### D-011: Goal Progress

**Question:** Should Goal progress be calculated from completed Actions?

**Recommendation:** Actions are binary or simple-state work items, but Goal progress is not automatically equated with Action completion. A Goal may have an optional measurable target, current value, unit, due date, and user-controlled status. The assistant may propose progress updates with evidence, but the user approves them.

**Why:** Completing ten low-value Actions does not necessarily mean a Goal is 100% achieved. Separating outcome metrics from effort prevents false confidence and supports genuinely SMART Goals.

### D-012: Agent Memory

**Question:** What should the assistant remember across conversations?

**Recommendation:** Use explicit, user-editable personal memory. The assistant may propose durable preferences, constraints, and recurring facts for memory, but it does not silently treat all Notes, Captures, or chat summaries as permanent memory. Memory changes are reversible and visible in Settings.

**Why:** Long-term memory makes the assistant useful, but hidden memory creates privacy and correction problems. A visible memory layer gives the user control and fits the single-owner Workspace.

### D-013: AI Provider Strategy

**Question:** Should Planner AI depend on one AI provider or support several immediately?

**Recommendation:** Define capability roles for `agent`, `structured-analysis`, `transcription`, and `embedding/search`, with provider adapters behind each role. Ship one tested default per role and one fallback for the agent-critical path; select exact models through evaluation fixtures rather than hardcoding the whole product to Groq, OpenAI, Anthropic, or Gemini.

**Why:** Agent Native and the existing MVP currently pull in different provider assumptions. A small role-based boundary gives reliability and cost control without building a sprawling provider marketplace.

### D-014: External MCP Defaults

**Question:** What should an external AI receive when it first connects to Planner AI?

**Recommendation:** Use Agent Native's per-user OAuth flow. Grant read-only discovery and read Operations by default. Require an explicit `mcp:write` grant for mutations, keep `offline_access` opt-in, and apply the same risk/approval model as in-app chat. Do not issue deployment-wide static bearer tokens to users.

**Why:** This lets Claude, ChatGPT, Codex, and other MCP hosts use Planner AI while keeping identity, revocation, and write authority understandable and auditable.

### D-015: Automation Authority

**Question:** What may scheduled or event-driven automations do without the user present?

**Recommendation:** Automations can run read Operations and create drafts, proposals, reminders, and Inbox items. Reversible writes require an explicit automation grant. Consequential or external effects create an approval request and wait; they never inherit unrestricted interactive-agent access.

**Why:** Agent Native automations can otherwise use the agent's entire toolset. A separate automation allowlist prevents an old schedule or prompt from silently making high-impact changes later.

### D-016: First-Release Offline Behavior

**Question:** How much should work without a network connection?

**Recommendation:** The first release remains online-first, but the PWA stores unsent typed/voice Captures in an encrypted local queue and retries safely. Cache the shell and recent read-only data. Do not allow offline Plan or Note editing until conflict resolution is designed.

**Why:** Capture must never be lost because a phone loses signal. Full offline editing would introduce the local/cloud conflict engine that the Supabase decision intentionally deferred.

## Sources Informing This Batch

- Agent Native Content overview: https://www.agent-native.com/docs/template-content
- Content local files and sync: https://www.agent-native.com/docs/template-content-sync
- Agent Native external MCP agents: https://www.agent-native.com/docs/external-agents
- Agent Native automations: https://www.agent-native.com/docs/automations
- Agent Native resources and memory: https://www.agent-native.com/docs/agent-resources

## Accepted Batch 2: Daily Planning And Knowledge Workflow

Accepted together after review. The recommendations below are now requirements.

### D-017: Capture Processing

**Question:** What happens when AI processes a raw Capture?

**Recommendation:** Keep the Capture immutable and create a separate reviewable Proposal that may suggest zero or more Actions, Note updates, Goal links, tags, blockers, or reflections. Applying a Proposal records exactly what changed; dismissing it leaves the Capture intact. Capture states are `new`, `proposed`, `reviewed`, and `archived` rather than a vague processed flag.

**Why:** One voice dump may contain several ideas and pieces of work. A separate Proposal preserves the person's words, supports retries with better models, and makes AI changes traceable.

### D-018: Focus Limits

**Question:** Should Planner AI enforce a maximum number of active priorities?

**Recommendation:** Do not hard-block creation, but design Today around at most three highlighted daily priorities and Review around at most five committed weekly Actions. Show an overload warning and require deliberate replacement when the highlighted set is full.

**Why:** The product should improve focus rather than become an infinite backlog. Soft limits preserve user control while making overcommitment visible.

### D-019: Recurring Work And Habits

**Question:** Should the first release become a habit tracker?

**Recommendation:** Do not add a general habit system. Support simple recurring Action templates for weekly or monthly work, where each occurrence becomes an ordinary Action with its own history. Defer streaks, habit scores, complex recurrence rules, and health-style tracking.

**Why:** Recurring planning work is necessary, but habit gamification would create a second product and distort the outcome-focused Goal model.

### D-020: Unfinished Action Rollover

**Question:** Should incomplete Actions automatically move into the next week?

**Recommendation:** Never roll them over silently. During Review, each unfinished Action must be rescheduled, reduced, linked to a blocker, dropped with a reason, or left overdue deliberately. Preserve its original scheduling history.

**Why:** Silent rollover hides chronic overcommitment and destroys useful evidence about drift. A quick review choice creates accountability without deleting history.

### D-021: Review Cadence

**Question:** Which reflection cycles are first-class?

**Recommendation:** Make Weekly Review the primary required workflow, supported by lightweight daily check-in/capture. Add Monthly and Quarterly Review templates that summarize lower horizons and feed the next plan; keep them optional and schedulable rather than mandatory blockers.

**Why:** Weekly review is frequent enough to steer behavior without becoming burdensome. Monthly and quarterly views are valuable for strategy but should not prevent daily use.

### D-022: Proactive Coaching

**Question:** How often should the AI coach interrupt or challenge the user?

**Recommendation:** Keep ordinary workspace screens quiet. Put proactive suggestions in Today, the Capture Inbox, and Review, with a configurable coaching intensity of `calm`, `direct`, or `strict`. Only user-enabled reminders may interrupt outside the app.

**Why:** The user wants a highly effective coach, but constant unsolicited prompts create fatigue. Concentrating coaching at decision moments makes it useful rather than decorative.

### D-023: Notification Channels

**Question:** Which notification channels should launch first?

**Recommendation:** Ship an in-app notification center and transactional email for explicitly scheduled reminders or account events. Defer browser push, SMS, Slack, Telegram, and other messaging integrations until notification preferences, delivery auditing, and quiet hours work reliably.

**Why:** Every outbound channel adds credentials, retries, privacy questions, and failure modes. In-app plus email covers the first release without turning Planner AI into a messaging system.

### D-024: Search And Retrieval

**Question:** How should users and the assistant search Notes and planning history?

**Recommendation:** Build per-user Postgres full-text search first, with filters for type, Goal, horizon, tag, and date. Add semantic embeddings as a second retrieval signal only after privacy, deletion, reindexing, source citation, and evaluation tests are complete. Never let semantic results hide the exact source record.

**Why:** Exact search is predictable, inexpensive, and easy to delete correctly. Semantic retrieval is valuable for AI context, but it needs evaluation and lifecycle controls before becoming trusted infrastructure.

### D-025: Note Organization

**Question:** Should Notes use folders, tags, links, or all three?

**Recommendation:** Use one parent hierarchy, lightweight tags, and typed links/backlinks. Allow deep nesting in the data model but optimize the interface for six levels and warn when deeper nesting becomes hard to navigate. A Note may appear in one hierarchy location while linking to many Goals, Actions, Captures, and Notes.

**Why:** This preserves the familiar Obsidian tree while avoiding duplicate pages and adding the relationship power needed for planning.

### D-026: Notion And Obsidian Migration

**Question:** What migration support is necessary before Planner AI can replace the current tools?

**Recommendation:** Before beta, support dry-run import from a Notion Markdown/CSV export and an Obsidian Markdown folder or ZIP. Show the proposed hierarchy, unsupported content, duplicate handling, and record counts before committing. Preserve original files and provide an import report. Defer live two-way Notion sync.

**Why:** Replacing Notion requires a trustworthy exit path, not merely a new editor. A dry-run import is safer and simpler than permanent dual-system synchronization.

## Accepted Batch 3: Trust, Reliability, And Launch

Accepted together after review. The recommendations below are now requirements.

### D-027: Authentication Methods

**Question:** Which sign-in methods should Planner AI support first?

**Recommendation:** Launch with verified email/password and Google OAuth. Require a verified email before creating or opening a Workspace, and let Supabase automatically link a Google identity that has the same verified email. Keep password reset available through verified email. Defer magic-link-only, phone, anonymous, passkey, and additional social providers until the two primary paths are reliable.

**Why:** Email/password provides a universal recovery path and Google makes repeat sign-in easy. Limiting the initial methods reduces account duplication and authentication edge cases while still supporting the way the current owner wants to sign in.

### D-028: MFA And Account Recovery

**Question:** How should Planner AI protect accounts without making the private beta difficult to enter?

**Recommendation:** Offer Supabase TOTP MFA in Settings before inviting external beta users, encourage it during onboarding, and require an `aal2` session for changing login identities, issuing offline MCP access, exporting all data, or deleting the account. Do not require MFA for every beta login. Before enrollment, require the user to confirm a recoverable primary identity and explain how to add a backup factor; never invent or display recovery codes that the auth provider did not issue.

**Why:** Personal Notes, plans, and Memory are unusually sensitive, so high-impact account actions deserve a recent second factor. Optional enrollment avoids blocking early testing while the recovery experience is still being validated.

### D-029: Encryption And AI Processing Boundary

**Question:** Should first-release user content be end-to-end encrypted?

**Recommendation:** Do not claim or implement end-to-end encryption in the first release. Use TLS in transit, Supabase-managed encryption at rest, private Storage buckets, least-privilege server credentials, and application-level encryption for stored provider tokens or other secrets. Authorized Planner AI servers and explicitly selected AI providers may process the minimum required plaintext content. Make that boundary clear in Privacy and Settings.

**Why:** Server-side search, agent Operations, transcription, imports, and cross-device editing all need controlled access to content. Promising end-to-end encryption while retaining those capabilities would be misleading; a real E2EE design would require a different search, recovery, and agent architecture.

### D-030: Trash, Record Deletion, And Account Deletion

**Question:** How recoverable should deletion be?

**Recommendation:** Send user records to a 30-day Trash by default and support restore with original relationships intact. Emptying Trash is a consequential Operation with a preview and confirmation. Account deletion has a seven-day cancellation window, then permanently deletes active domain data, attachments, agent state, OAuth grants, and account access. Document that encrypted disaster-recovery backups age out under the backup retention schedule and are not selectively restored except during a full recovery event.

**Why:** Accidental deletion is common in planning and note tools, while indefinite soft deletion undermines user control. Separate record recovery from account erasure and state the backup limitation honestly.

### D-031: Backups And Disaster Recovery

**Question:** What recovery standard is required before external beta users trust Planner AI with their lives and notes?

**Recommendation:** Move production to Supabase Pro before external beta so the project does not pause and receives daily backups with seven-day retention. Add an encrypted off-site logical database export and a separate verified backup of private Storage objects because Supabase database backups do not contain those files. Target an initial recovery point objective of 24 hours and recovery time objective of four hours. Complete a restore drill before beta and repeat it quarterly; add point-in-time recovery when usage or paid commitments justify its cost.

**Why:** A backup that has never been restored is only an assumption. This level is practical for an early personal product, covers both database and attachments, and avoids paying for second-level recovery before the product needs it.

### D-032: Note Attachments

**Question:** Which files may users place in the Notes vault?

**Recommendation:** Add attachments after the Markdown editor is stable but before external beta. Store them only in an owner-scoped private Supabase Storage bucket. Initially allow common images, PDF, plain text, Markdown, and CSV up to 25 MB per file; treat voice Capture audio under the separate seven-day lifecycle. Validate declared and detected file types, quarantine uploads until malware checks pass, serve only through authenticated downloads or short-lived signed URLs, and include attachments in export, Trash, deletion, and backup behavior.

**Why:** Attachments are necessary for a credible Notion replacement, but unrestricted uploads create security, storage, rendering, and recovery liabilities. A narrow allowlist provides useful coverage with a testable boundary.

### D-033: Analytics And Diagnostic Privacy

**Question:** What may Planner AI measure about product use?

**Recommendation:** Keep essential security and operational telemetry always on but content-free. It may record Operation name, result, latency, error code, provider, model class, token/cost totals, and a pseudonymous user or Workspace identifier. Never send Note bodies, Capture text, transcripts, Memory, chat content, filenames, prompts, or session replay to analytics. Make product-behavior analytics opt-in during beta, keep raw events for 90 days, and provide an explicit temporary diagnostic-sharing control for support.

**Why:** Reliability cannot be improved without evidence, but a private life-planning product should not turn personal content into analytics exhaust. Separating required operational signals from optional product analytics keeps the promise understandable.

### D-034: Reliability Targets And AI Degradation

**Question:** What does "reliable" mean for the first release?

**Recommendation:** Set a beta service objective of 99.5% monthly availability for core authenticated planning Operations, excluding announced maintenance. A successful write response means the data is durably stored; retries use idempotency keys, and unsent Capture input survives interruption. Target p95 under 750 ms for ordinary core Operations. Track AI and transcription availability separately: when a provider fails, click-first planning, Notes, search, and raw Capture creation continue to work while AI jobs show status, preserve input, and can be retried or routed to an evaluated fallback.

**Why:** AI providers will fail independently of Planner AI. Defining the core as useful without AI prevents one vendor incident from locking the user out of their own system and gives testing an objective target.

### D-035: Production Deployment And Agent Native Isolation

**Superseded by D-057 and ADR-0024.** The recommendation below is retained only as feasibility history.

**Question:** Where should the web product, domain data, and Agent Native framework state run?

**Recommendation:** Deploy the Next.js product to Vercel and keep Planner AI domain data in the existing production Supabase project. Deploy a minimal Agent Native runtime separately with its own persistent managed Postgres database for framework state. Embed its sidecar UI into `web` through a strict origin and short-lived, server-verified identity bridge. Agent Native calls Planner AI Operations for domain changes and never duplicates or directly owns Goals, Actions, Notes, Captures, or Memory.

**Why:** Separate deployment and storage avoid framework collisions, prevent a runtime migration from touching domain tables, and allow independent rollback. The product remains one interface even though its agent runtime has a separate operational boundary.

### D-036: Beta Launch And Monetization Boundary

**Question:** When is Planner AI ready for other people, and should they pay immediately?

**Recommendation:** Use three stages: owner dogfooding, a free invite-only beta of roughly 10 to 20 users, then a wider capped beta. Do not add billing in the first invite-only stage. Entry requires reliable auth, onboarding, critical UI/chat parity, dry-run import, export, Trash/deletion, tested backups, monitoring, and no open severity-one defects. Expansion requires four consecutive weeks within the core reliability objective, successful restore and security reviews, and evidence that users repeatedly complete Capture, Today, Notes, and Weekly Review workflows. Price only after usefulness and retention are demonstrated.

**Why:** Charging before the trust and retention loops work adds billing obligations without proving value. A deliberately small beta exposes real workflows while failures are still supportable and reversible.

## Sources Informing This Batch

- Supabase identity linking: https://supabase.com/docs/guides/auth/auth-identity-linking
- Supabase multi-factor authentication: https://supabase.com/docs/guides/auth/auth-mfa
- Supabase TOTP authentication: https://supabase.com/docs/guides/auth/auth-mfa/totp
- Supabase database backups: https://supabase.com/docs/guides/platform/backups
- Supabase private Storage buckets: https://supabase.com/docs/guides/storage/buckets/fundamentals

## Accepted Batch 4: Assistant Experience And Product Reach

Accepted together after review. The recommendations below are now requirements.

### D-037: Assistant Context Scope

**Question:** How much of a person's Workspace should the assistant read for each message?

**Recommendation:** Start every turn with minimal structured context: the current route, selected record or text, Workspace timezone, and explicitly attached items. Retrieve other records only through authorized read Operations when the request requires them, and show the sources used. Let a user exclude a Note from AI processing and temporarily limit a conversation to selected records. Never send the entire Notes vault or screen text to a provider by default.

**Why:** Context awareness makes "this" and "that goal" intuitive, but indiscriminate context increases cost, latency, and privacy exposure. Retrieval through the same permission boundary keeps the assistant capable without treating the whole Workspace as one permanent prompt.

### D-038: Chat History Lifecycle

**Question:** Is a Planner AI conversation a durable knowledge record?

**Recommendation:** Retain chat threads until the user deletes them by default, with rename, archive, search, export, and delete controls. A chat thread is conversation history, not a Note, Capture, or Memory; useful content becomes one of those only through an explicit Operation or Proposal. Deleting a thread removes its messages and content-bearing tool results, while minimal content-free security and Operation audit records follow their independent retention policy. Add an optional automatic chat-expiry setting later.

**Why:** Durable chat lets a person resume planning work and understand prior actions, but silently turning conversations into permanent knowledge would blur the accepted data model. Explicit promotion preserves both usefulness and control.

### D-039: AI Provider Data Policy

**Question:** Which AI services may receive personal Planner AI content?

**Recommendation:** Production may use only paid API or enterprise service paths whose current terms do not use customer inputs or outputs for model training by default and whose retention behavior is documented. Maintain a provider register describing purpose, data categories, region, retention, subprocessors, and deletion limitations. Send the minimum context needed, prefer zero- or reduced-retention modes when compatible, and never route personal content through a consumer chat account or a free API tier that may use it for product improvement. Planner AI itself never trains on personal content without a separate explicit opt-in.

**Why:** A provider-independent adapter is not enough if adapters have materially different data terms. A reviewed provider register turns privacy from a model-name assumption into an enforceable release requirement.

### D-040: AI Credentials, Usage, And Cost Controls

**Question:** Should beta users supply their own model API keys?

**Recommendation:** Use Planner AI-managed, server-side provider credentials during dogfooding and invite-only beta. Do not accept bring-your-own-key credentials initially. Give every Workspace visible AI usage, a monthly soft budget, per-Operation token and tool-call limits, rate limits, and a hard platform spending cap. Route ordinary work to the least expensive evaluated model and require an explicit user choice before unusually expensive analysis. Add bring-your-own-key only if later demand outweighs the security and support cost.

**Why:** Managed credentials make privacy configuration, fallback behavior, cost measurement, and support consistent. Early BYOK would add secret storage, provider-specific setup, quota failures, and unclear responsibility before the core experience is proven.

### D-041: AI Evidence And Explanation

**Question:** How should the assistant justify recommendations and changes?

**Recommendation:** Proposals, planning recommendations, and summaries must link to the exact Goals, Actions, Notes, Captures, Reviews, or external sources that support them. Clearly label statements as `supported`, `inferred`, or `needs input`; do not display invented numerical confidence scores. Before a write, explain the intended result and exact affected records at the detail required by its risk class. Provide concise user-facing reasoning, not hidden chain-of-thought or raw internal prompts.

**Why:** Source links make AI output correctable and useful. Evidence categories communicate uncertainty more honestly than arbitrary percentages while preserving private internal reasoning and implementation details.

### D-042: First-Run Onboarding

**Question:** What must a new user complete before Planner AI becomes useful?

**Recommendation:** Offer a skippable guided setup that takes about ten minutes: confirm timezone and week start, explain AI/privacy controls, optionally draft a Vision, create one Goal and one Action, make a first typed or voice Capture, and schedule Weekly Review. Offer Notion or Obsidian import as an optional branch rather than a prerequisite. Request microphone permission only when the person initiates voice capture, and never block access to an empty Workspace because onboarding is incomplete.

**Why:** The first session should produce a real planning loop rather than a tour or fake dashboard. Skipping and progressive permission requests respect experienced users and avoid trapping someone in setup.

### D-043: Calendar Model And Integration Order

**Question:** Should Planner AI Actions become calendar events automatically?

**Recommendation:** Keep an Action and a Calendar Event as different concepts. An Action may have a planning date or be linked to an Event, but it does not become an Event automatically. After the invite-only beta is stable, add Google Calendar first with user-selected calendars and read-only availability/event context; add confirmed event creation or updates only after read behavior is trusted. Calendar writes are consequential, preserve the external event ID and sync status, and never bulk-schedule Actions silently. Defer Outlook Calendar and email-inbox access.

**Why:** Work to complete and reserved time have different lifecycles. Separating them prevents calendar edits from corrupting planning history and lets the integration grow from low-risk context to deliberate writes.

### D-044: Mobile Product Strategy

**Question:** Does the first legitimate release require native iOS and Android apps?

**Recommendation:** Ship a responsive, installable Progressive Web App first. It must support touch, mobile navigation, browser-based voice Capture, local unsent-Capture recovery, and the same authenticated data as desktop. Do not build native wrappers or separate mobile clients until beta evidence shows that browser limitations materially block repeated use. Push notifications remain deferred under the accepted notification boundary.

**Why:** One web product keeps UI, authentication, Operations, and parity tests aligned while still covering the main mobile workflow. Native clients would multiply release and synchronization work before the daily product loop is validated.

### D-045: Accessibility Standard

**Question:** What accessibility level is required rather than merely desirable?

**Recommendation:** Treat WCAG 2.2 Level AA as the acceptance target for all core workflows. Test keyboard-only use, visible and unobscured focus, screen-reader names and announcements, contrast, zoom and reflow, reduced motion, touch target size, accessible authentication, error recovery, and alternatives to drag or voice. Use automated checks in CI plus manual keyboard and screen-reader testing before each beta expansion.

**Why:** A planning system is repeated-use infrastructure, so accessibility defects become daily friction. WCAG 2.2 AA provides a concrete standard and specifically strengthens focus, target-size, dragging, and authentication expectations relevant to this product.

### D-046: Operation Contract Evolution

**Question:** How can every new feature become AI- and MCP-controllable without breaking existing clients?

**Recommendation:** Give every exposed Planner AI Operation a stable semantic identifier, versioned input/output schema, risk metadata, and machine-readable capability description. Backward-compatible additions stay within the current major version; breaking changes ship as a new major version beside the old one. UI, chat, automation, and MCP parity tests run against the same contract. During private beta, deprecations require documented migration and notice; after public launch, keep deprecated external versions for at least 90 days unless a security issue requires faster removal.

**Why:** Agent Native can fan one action into many surfaces, which makes contract drift especially expensive. Explicit versioning lets features evolve while external agents, automations, and older clients migrate predictably.

## Sources Informing This Batch

- Agent Native context awareness: https://www.agent-native.com/docs/context-awareness
- Agent Native embedding SDK: https://www.agent-native.com/docs/embedding-sdk
- Agent Native actions: https://www.agent-native.com/docs/actions
- Agent Native resources and memory: https://www.agent-native.com/docs/agent-resources
- OpenAI API data controls: https://platform.openai.com/docs/models/default-usage-policies-by-endpoint
- Gemini API data and zero-retention controls: https://ai.google.dev/gemini-api/docs/zdr
- Google Calendar event model: https://developers.google.com/workspace/calendar/api/v3/reference/events
- W3C WCAG 2.2 overview: https://www.w3.org/WAI/standards-guidelines/wcag/

## Accepted Final Review: Engineering Closure

These decisions close gaps found by reconciling the accepted product direction with the actual prototype, current SQL, and Agent Native runtime. They are requirements.

### D-047: Canonical Relational Domain

**Decision:** Model Vision, Goal, Action, Planning Horizon, Capture, Proposal, Note, Review, Memory, and their relationships explicitly under a Workspace. Do not carry the prototype's separate yearly/quarterly/monthly/weekly tables forward, and do not adopt the standalone agent prototype's unrestricted generic node tree.

**Rationale:** The product language has distinct rules, lifecycles, and permissions. Explicit entities let PostgreSQL enforce them, keep queries understandable, and prevent a generic hierarchy from becoming an untyped application framework.

### D-048: One Operation Service

**Decision:** Every durable write uses a transport-neutral Operation service with typed validation, explicit actor/context, authorization, idempotency, transaction handling, audit metadata, and stable errors. Next.js Server Actions, internal HTTP, Agent Native, MCP, and automations are adapters around that service rather than separate business-logic implementations. Browser code does not write domain tables directly.

**Rationale:** Next.js Server Actions alone cannot serve chat, MCP, and unattended jobs safely. A shared service preserves parity and gives multi-record changes one atomic boundary.

### D-049: Production Code And Extension Boundary

**Decision:** Production agent code execution is `off`. Arbitrary generated HTML extensions, uploaded executable skills, source editing, shell, and filesystem tools are disabled for the first release. Planner AI may ship reviewed prompt-only skills and typed Assistant Profile controls; sandboxed extensions require a later security review, manifest allowlist, and separate launch decision.

**Rationale:** Agent Native supports powerful developer and extension features, but enabling them would contradict the accepted production capability boundary and greatly expand the prompt-injection and exfiltration surface.

### D-050: Outbound MCP Connections

**Decision:** First release supports inbound MCP, where an external AI controls approved Planner AI Operations. Planner AI acting as a client of third-party MCP servers is deferred until after invite beta. It then starts with approved remote HTTP servers using OAuth and narrow scopes; local processes, `stdio`, arbitrary URLs, and pasted bearer-token configuration remain unavailable in the hosted product.

**Rationale:** Inbound and outbound MCP are different trust directions. Outbound tools can create effects and expose data outside Planner AI, so they need connection-level review and revocation before becoming agent capabilities.

### D-051: Untrusted Content Boundary

**Decision:** Notes, imports, attachments, webpages, Calendar Events, search results, MCP results, and other external material are data, never system instructions. Their provenance remains visible; retrieved instructions cannot change tool permissions, approval policy, recipient, destination, or data scope. Prompt-injection and exfiltration fixtures are release tests.

**Rationale:** Model prompting alone cannot eliminate indirect prompt injection. Separating authority from content and constraining tools limits the impact when untrusted text contains malicious instructions.

### D-052: Connection Secret Handling

**Decision:** OAuth refresh tokens and other connection secrets are encrypted server-side with keys outside the database, bound to an approved provider and destination domain, redacted from logs, inaccessible to models and browser code, rotatable, and revocable. Users are never instructed to paste production secrets into chat.

**Rationale:** A model or generated extension does not need raw credentials to call an approved integration. A server-side proxy can apply the secret only to the intended destination.

### D-053: Support Access

**Decision:** Operators have no standing access to Workspace content and cannot impersonate a user. Support begins with content-free diagnostics. Any content-bearing diagnostic bundle is user-selected, previewed, purpose-bound, time-limited, auditable, revocable, and excluded from model training and product analytics.

**Rationale:** Private life-planning data deserves a stronger default than ordinary SaaS support access. User-mediated diagnostics preserve supportability without creating an invisible back door.

### D-054: User-Visible Activity

**Decision:** Planner AI exposes an Activity trail for all durable writes and sensitive or consequential reads, including actor, surface, Operation, target, timestamp, risk/approval, and outcome. Inputs remain omitted or redacted by default. Activity is exportable and retained until account deletion, while lower-level operational telemetry follows its shorter policy.

**Rationale:** Users need to answer what changed, who or what changed it, and whether an external agent was involved without turning the audit trail into another copy of private content.

### D-055: Safety Scope

**Decision:** Invite beta is for adults and Planner AI presents itself as planning and reflection software, not professional medical, legal, financial, diagnostic, or crisis care. It avoids coercive or shame-based coaching, does not autonomously contact third parties, and responds to high-risk content with supportive limits and appropriate help resources while preserving user control.

**Rationale:** Personal planning can surface sensitive situations. A clear scope prevents the coaching interface from implying expertise or authority it does not have.

### D-056: Repository And Document Authority

**Superseded in part by D-057. Decision retained:** The Next.js `web` application is the only product shell. The current standalone `planner` application is a reference artifact for reviewed patterns, not a runtime or migration destination. `database/schema.sql` is a legacy prototype snapshot and must not be applied as the target schema. The Product Direction, PRD, Architecture, Data Model, Roadmap, Context glossary, Decision Register, and accepted ADRs are the canonical documentation set.

**Rationale:** Multiple apps, schemas, and roadmaps currently tell different stories. Naming authority prevents accidental implementation against obsolete cascade or local-first designs.

### D-057: Agent Native Feasibility Result

**Decision:** Adapt the useful Agent Native patterns into `web` without shipping the Agent Native runtime or a second application database in the first release. Durable Conversations, Proposals, approvals, Memory, Activity, and inbound MCP use the shared Planner AI Operation layer and Supabase trust boundary. `planner` remains reference-only. A future runtime requires a new ADR and evidence that it delivers a necessary capability more safely than extending `web`.

**Rationale:** The imported runtime duplicates authentication, routing, persistence, and a large chat stack while the product capabilities fit cleanly behind the existing Operation boundary. One runtime reduces identity delegation, deployment, recovery, and upgrade risk without giving up the desired AI behavior.

## Sources Informing Final Review

- Agent Native embedding and database isolation: https://www.agent-native.com/docs/embedding-sdk
- Agent Native production deployment and code execution: https://www.agent-native.com/docs/deployment
- Agent Native extensions and sandbox boundary: https://www.agent-native.com/docs/extensions
- Agent Native MCP client direction: https://www.agent-native.com/docs/mcp-clients
- OWASP LLM prompt-injection guidance: https://owasp.org/www-project-top-10-for-large-language-model-applications/
