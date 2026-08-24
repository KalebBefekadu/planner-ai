# Planner AI Product Direction

## Product Intent

Planner AI is a private, voice-first planning and knowledge Workspace. It brings personal goals, plans, notes, and reflection into one calm product. A person must be able to work through the interface directly and also ask an AI assistant to perform the same meaningful Operations.

The product is not a chatbot with a few planning screens. It is a dependable planning workspace with an AI partner available when it is useful.

## Experience Principles

- The workspace is primary: people can navigate, write, plan, and review without using chat.
- The assistant is contextual: it understands the open page, selected goal, or selected note.
- Voice is a first-class capture method. Raw capture is always preserved before AI interpretation.
- AI organizes and proposes; the person retains control over important changes.
- Every durable change is traceable, reversible where practical, and performed through one shared Operation service.
- The assistant starts from the current context and retrieves only the additional records needed for the request.
- AI recommendations link to their evidence and distinguish supported facts from inference or missing input.
- The interface should be focused, responsive, useful for repeated daily work, and meet WCAG 2.2 Level AA across core workflows.

## Core Workspace

The initial product will center on four connected areas:

1. **Today**: current priorities, weekly actions, recent captures, and a clear next step.
2. **Plan**: the connection from Vision to yearly and quarterly Goals, then to monthly and weekly Actions.
3. **Notes**: lightweight, hierarchical, Markdown-friendly personal notes connected to goals and plans.
4. **Review**: reflection, progress, completed work, and AI-generated planning suggestions.

Voice capture enters an Inbox first. The system stores the original transcript, then can propose a title, summary, tags, related Goals, Actions, and a destination note. The user reviews and applies the proposal, with optional trusted automation later.

The raw Capture remains immutable. AI processing creates a separate Proposal that may contain multiple suggested changes. Applying a Proposal records each resulting Operation; dismissal or reprocessing never rewrites the source Capture.

Today emphasizes at most three daily priorities, and Weekly Review emphasizes at most five committed weekly Actions. These are focus limits rather than creation limits. Unfinished Actions never roll forward silently; Review asks the user to reschedule, reduce, link a blocker, drop with a reason, or leave the Action overdue while preserving its scheduling history.

First-run onboarding is skippable and aims to complete one real loop in about ten minutes: confirm time settings, explain AI/privacy controls, optionally draft a Vision, create one Goal and Action, make a first Capture, and schedule Weekly Review. Import is optional, and microphone permission is requested only when voice Capture begins.

## AI And MCP Direction

Planner AI presents a docked assistant inside the existing `web` product. The first release adapts Agent Native's action, context, approval, and MCP patterns without shipping a second runtime. Durable chat, Proposals, Memory, and grants remain in canonical Supabase and every write reaches Planner AI only through authorized Operations.

Every product capability must be implemented through one validated Planner AI Operation. The human interface, Planner AI chat, voice workflows, automations, and external MCP clients call that same Operation according to their permissions. Examples include:

- create, edit, complete, and archive a Goal or Action;
- create, update, organize, and link a note;
- save a transcript and turn it into a reviewable proposal;
- analyze a goal for SMART quality;
- create a weekly plan from the current Goals and Actions.

External MCP access must be authenticated, scoped, audited, and limited to deliberately exposed operations. It must not provide raw database access.

A feature is not complete merely because its screen works. It is complete when its Operation is validated and authorized, the interface uses it, the assistant can use it with the correct context and approval behavior, external exposure is explicitly classified, and parity tests pass.

Every exposed Operation has a stable semantic identifier, a versioned input/output contract, risk metadata, and a machine-readable description shared across UI, chat, automation, and MCP. Breaking changes run beside the prior major version during a documented compatibility window.

The production assistant may use authorized Planner AI product Operations and narrowly granted user-scoped automations. First-release production disables code execution, extension installation, shell, repository, deployment, arbitrary network, service-role, and secret-management capabilities. Those Agent Native capabilities remain restricted to isolated development workflows; any later extension system requires a separate security decision and release gate.

Operations use risk-based approvals. Reads run immediately. Low-risk reversible writes execute with visible undo. Destructive, bulk, external, or difficult-to-reverse Operations show an exact preview and require confirmation. Prohibited production capabilities remain unavailable rather than confirmable.

Each assistant turn starts with route, selection, Workspace timezone, and explicitly attached records rather than the whole vault or visible screen. Additional context comes through authorized read Operations. A person may apply an AI Exclusion to a Note or temporarily scope a Conversation to selected records.

Conversations are durable, searchable, exportable, archivable, and deletable, but they are not Notes, Captures, or Memory. Turning useful conversation content into durable knowledge requires an explicit Operation or Proposal. AI output cites exact product or external sources and labels statements as supported, inferred, or needing input without exposing hidden chain-of-thought.

## Data Ownership Direction

Supabase Postgres is the authoritative source for the first legitimate release. It provides the shared data boundary for the web workspace, the assistant, mobile access, and external MCP operations.

Authentication launches with verified email/password and Google OAuth. TOTP MFA is optional during private beta, but a recent second factor is required for sensitive account Operations such as changing identities, issuing offline MCP access, full export, and account deletion.

Planner AI must provide complete export, including Markdown for notes, but local files are not a second writable source during the first release. True local-first storage and sync remain a later capability that requires explicit conflict resolution, encryption, offline identity, and migration design.

The first release supports multiple registered users, but each Workspace is private and has exactly one owner. Sharing, teams, organizations, public pages, and collaborative editing are later capabilities with separate permission and privacy decisions.

The first release has no Agent Native framework database. If a later capability justifies a sidecar, it must use a separate managed database and short-lived stable-ID delegation under ADR-0024; browser-supplied identity is never trusted.

## Notes Direction

The Agent Native **Content** template is the future reference for the notes experience. It provides a rich editor, hierarchical pages, Markdown/MDX support, search, history, and database-style views. We will adopt its relevant capabilities after the core MVP is reliable rather than merging another complete application into the current project.

The initial notes experience should be simpler than Notion and closer to an organized personal vault: pages, hierarchy, links, search, capture inbox, and goal connections. Advanced databases, local-file mode, and broad imports follow later.

Normalized Markdown in Supabase is the canonical Note body. The first editor supports dependable rich Markdown rather than executable MDX, document databases, publishing, comments, or real-time collaboration.

After the editor is stable, Notes support restricted attachments before external beta. Common images, PDF, text, Markdown, and CSV files up to 25 MB use private owner-scoped Storage, malware quarantine, authenticated access, and complete export, Trash, deletion, and backup behavior.

## Intelligence And Privacy Defaults

Planner AI preserves raw Capture text before interpretation. Temporary audio is deleted after successful transcription; failed encrypted audio expires after seven days unless deleted sooner.

Cross-conversation Memory is explicit, visible, editable, and reversible. The assistant may propose a memory update, but Notes, Captures, and chat summaries do not silently become permanent Memory.

AI providers sit behind capability roles for agent reasoning, structured analysis, transcription, and embedding/search. Model selection is based on evaluation fixtures, reliability, privacy, latency, and cost rather than a product-wide vendor dependency.

Production providers must use paid API or enterprise paths with documented retention and no training on customer inputs or outputs by default. A reviewed provider register records purpose, data categories, region, retention, subprocessors, and deletion limits. Planner AI never trains on personal content without separate explicit opt-in.

Dogfooding and invite beta use Planner AI-managed server credentials rather than user-supplied model keys. Workspaces receive visible AI usage, soft monthly budgets, per-Operation limits, rate limits, and a hard platform spending cap. Ordinary work uses the least expensive evaluated model, and unusually expensive analysis requires an explicit user choice.

External MCP clients use per-user OAuth with read access by default and explicit write or offline grants. Automations have narrower unattended authority than interactive chat and must wait for approval before consequential or external effects.

Imported Notes, attachments, websites, calendar text, and MCP responses are untrusted data, never instructions. Prompt wording is not the security boundary: tool allowlists, schema validation, destination controls, authorization, minimal context, egress restrictions, and adversarial evaluation enforce it.

Provider and integration secrets are encrypted server-side with purpose-bound access and versioned rotation. Plaintext secrets never enter browser state, model context, Activity, telemetry, support tools, or Agent Native framework records.

The first release is online-first. It must preserve unsent mobile Captures across connectivity loss, but offline Plan and Note editing are deferred until conflict resolution is designed.

Weekly Review is the primary reflection loop, supported by lightweight daily check-in and optional Monthly and Quarterly Review templates. Coaching appears at decision points in Today, Inbox, and Review, with calm, direct, or strict intensity selected by the user.

First-release notifications are in-app plus transactional email for explicitly scheduled reminders and account events. Search begins with per-user Postgres full-text search and exact source links; semantic retrieval follows only after privacy, deletion, reindexing, citation, and evaluation controls pass.

Notes combine one parent hierarchy, lightweight tags, and typed links/backlinks. Before beta, Planner AI must offer dry-run imports from Notion Markdown/CSV exports and Obsidian Markdown folders or ZIP files, with unsupported-content and duplicate reports. Live two-way Notion sync is deferred.

Planner AI does not claim end-to-end encryption in the first release. Content is protected in transit and at rest, provider credentials receive additional application-level protection, and authorized servers or selected AI providers process only the plaintext required for requested behavior. Privacy and Settings explain this boundary directly.

Planner AI is an adult planning and reflection product. It does not diagnose, provide professional medical, legal, or financial advice, or present itself as crisis care. High-risk requests receive bounded assistance and appropriate direction without pretending the system has professional authority.

Operational telemetry is content-free and may describe an Operation, result, latency, error, provider class, cost total, and pseudonymous identity. It never sends personal content, filenames, prompts, or session replay to analytics. Product-behavior analytics is opt-in during beta, and raw events expire after 90 days.

Support has no standing access to private Workspace content and cannot impersonate a user. Exceptional production access is time-limited, approved, reasoned, logged, and user-visible where legally possible. Users can inspect Activity for important reads, writes, approvals, integrations, exports, and security events.

Records enter a recoverable 30-day Trash. Account deletion has a seven-day cancellation window before active data, attachments, grants, agent state, and access are removed. Disaster-recovery backups expire under their documented schedule rather than pretending to support selective immediate erasure.

## Product Reach

The first mobile product is the responsive, installable Planner AI PWA. It shares authentication, data, Operations, and acceptance tests with desktop while supporting touch navigation, browser voice Capture, and local recovery of unsent Captures. Native iOS and Android clients wait for evidence that browser limitations prevent repeated use.

Actions and Calendar Events remain separate. An Action may have a planning date or link to reserved time but never becomes an Event automatically. After the invite-only beta is stable, Google Calendar begins with user-selected read-only event and availability context; exact-preview writes follow later. Outlook Calendar and email-inbox access remain deferred.

## Trust, Reliability, And Launch

Core planning must remain useful when every AI provider is unavailable. Click-first planning, Notes, exact search, and raw Capture creation continue to work while AI jobs expose status, preserve source input, and retry or use only evaluated fallbacks.

Before external beta, production moves to a paid Supabase tier with daily backups and no inactivity pausing. Encrypted off-site logical database exports and a separately verified Storage backup cover the gap that database backups do not include uploaded objects. The initial recovery targets are a 24-hour recovery point and four-hour recovery time, proven before beta and quarterly thereafter.

Launch proceeds from owner dogfooding to a free invite-only beta of roughly 10 to 20 people, then to a wider capped beta. Billing waits until the product demonstrates repeated completion of Capture, Today, Notes, and Weekly Review workflows, four consecutive weeks within the core reliability objective, and successful restore and security reviews.

## Delivery Order

1. Back up and contain the original `web` MVP, especially authentication, signup, AI routes, secrets, and provider spend.
2. Migrate to the canonical relational model with repeatable Supabase migrations, RLS isolation tests, and automated quality gates.
3. Establish the transport-neutral Operation service and move existing durable writes onto it.
4. Adapt reviewed Agent Native patterns into the shared Operation, assistant, approval, and MCP surfaces; keep the imported runtime out of production.
5. Build Today, Plan, Notes, and Review as click-first, Operation-backed workspace surfaces with assistant parity.
6. Adopt selected Content capabilities for Notes without creating another source of truth or framework-owned domain model.
7. Add safe AI Proposals, Memory, fallback behavior, and evaluated coaching workflows.
8. Add narrowly scoped inbound MCP and automation access only after in-app permissions and approvals pass.
9. Complete import, export, Trash/deletion, backup restore, security review, and staged-beta gates before launch.
10. Add read-only Google Calendar, then approved outbound MCP, only after invite-beta reliability is proven.

## Definition Of Reliable

- No mock success states for persistent operations.
- Clear loading, empty, error, and success states for every core workflow.
- Authentication and per-user data boundaries are enforced at every data operation.
- Core workflows have automated verification and visual checks on desktop and mobile layouts.
- AI failures never discard user input or prevent ordinary planning work.
- Data changes are validated server-side and query only the current user's records.
- Core authenticated Operations meet a 99.5 percent beta availability objective and ordinary Operations target p95 latency below 750 ms.
- A successful write response means durable storage; retries are idempotent and unsent Capture input survives interruption.
- Recovery meets the initial 24-hour recovery point and four-hour recovery time targets in a real restore drill.
- Core workflows pass automated accessibility checks plus manual keyboard and screen-reader verification against WCAG 2.2 Level AA.
- Assistant outputs show their sources, honor AI Exclusions, and never require whole-Workspace prompt dumps.
