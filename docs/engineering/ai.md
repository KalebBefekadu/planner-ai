# Planner AI Intelligence Architecture

Status: **Approved AI integration requirements.** AI is optional infrastructure around a fully usable planning product.

## Principles

1. AI proposes or invokes authorized Operations; it does not bypass the domain.
2. Raw user input is preserved before interpretation.
3. Context is minimal, source-linked, and subject to AI Exclusion.
4. Model output is untrusted until validated.
5. Provider outage must not disable Today, Plan, Notes, Review, exact search, or raw Capture.
6. Provider, model, prompt, schema, and evaluation versions are observable without logging content.

## Capability Roles

| Role                  | Purpose                                                   | First-release behavior                                                       |
| --------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `agent`               | Conversation, planning reasoning, and Operation selection | Planner AI server adapter with one evaluated primary and fallback            |
| `structured-analysis` | Capture Proposals, SMART review, Review summaries         | Schema-constrained output with no direct writes                              |
| `transcription`       | Convert temporary audio into raw Capture text             | Durable job state, retry, and explicit audio lifecycle                       |
| `retrieval`           | Find exact Workspace sources                              | PostgreSQL full-text first; embeddings only after lifecycle/evaluation gates |

Adapters hide provider-specific APIs. Product code requests a capability role plus a versioned task contract, not a vendor model name.

## Request Lifecycle

1. Verify user, Workspace, feature grant, AI Exclusion, and budget.
2. Create durable AI job metadata where work can outlive one request.
3. Resolve only required source records through authorized read Operations.
4. Mark external/imported content as untrusted and preserve provenance.
5. Apply context and output size limits before provider submission.
6. Call the approved provider with timeout, cancellation, and retry classification.
7. Parse and validate the response against a versioned schema.
8. Store a Proposal or response with source links; do not mutate domain records.
9. Record content-free usage, latency, provider class, and outcome.
10. Apply approved changes through exact risk-classified Operations.

## Context Assembly

Default context includes only:

- stable user and Workspace identifiers known to the server;
- Workspace timezone and week start;
- current semantic route and selected record IDs;
- text explicitly attached to the turn;
- Assistant Profile and explicit Memory needed for the request;
- concise Operation descriptions permitted for that surface.

Additional Notes, Goals, Actions, Captures, Reviews, or Conversations are fetched on demand. The whole vault, DOM, visible screen text, raw audit log, or unrelated history is never placed into every prompt.

## Evidence

Proposals and recommendations attach exact source references. User-facing output labels claims:

- `supported`: directly grounded in a cited source;
- `inferred`: a reasonable interpretation requiring user judgment;
- `needs input`: important information is missing or contradictory.

Do not display arbitrary numerical model confidence. Explain intended effects and affected records at the Operation's risk level. Do not expose hidden chain-of-thought, provider system prompts, or secret-bearing tool traces.

## Capture And Transcription

- Browser audio is temporary input, not the durable record.
- Enforce duration, byte-size, detected media type, and per-user rate limits before upload/provider use.
- Save raw transcript text exactly after encoding safety checks; do not collapse whitespace as generic goal validation currently does.
- Delete audio after successful transcription.
- Retain failed encrypted audio for at most seven days for retry, then purge.
- If the upload or provider fails, preserve local input/status and offer retry or deletion.
- Live browser speech captions are optional feedback and are not treated as the canonical transcript.

## Proposal Contracts

Structured AI may propose zero or more typed items:

- create or edit Action;
- create or edit Note;
- connect Goal, Action, Note, Capture, or Review;
- add tag or blocker;
- propose Goal Progress evidence;
- propose explicit Memory;
- add reflection or Review prompt.

Every item includes source links, rationale category, schema version, and proposed risk class. Invalid or unknown item types are rejected. Applying a Proposal is idempotent and atomic; partial application is represented explicitly rather than hidden.

## Provider Governance

Before production use, each provider feature has a register entry covering:

- capability role and approved model/features;
- paid/enterprise terms and training default;
- content and metadata categories sent;
- retention and zero/reduced-retention configuration;
- processing region and subprocessors;
- deletion and incident limitations;
- timeout, fallback, quota, and cost;
- evaluation result and approval date.

Consumer chat sessions and unsuitable free API tiers cannot process personal Workspace content. Planner AI does not train on user content without a separate explicit opt-in.

## Cost And Abuse Controls

- Server-managed credentials only during dogfooding and invite beta.
- Per-user and per-Workspace distributed rate limiting; in-memory maps are not production controls.
- Monthly soft budget, hard platform cap, per-Operation token/tool limits, and concurrency limits.
- Least expensive evaluated model for routine work.
- Explicit confirmation before unusually expensive analysis.
- Authentication and quota checks occur before parsing large request bodies or calling a provider.
- Stable safe error messages return to users; provider errors and prompts never leak.

## Prompt-Injection Boundary

The following are untrusted data: Notes, imported files, attachments, webpages, Calendar Events, email, search results, MCP results, model output, and extension output.

Untrusted text cannot:

- grant or discover additional tools;
- change system/developer policy or risk class;
- approve an Operation;
- change recipient, URL, calendar, account, Workspace, or data scope;
- request raw secrets or hidden prompts;
- turn a read request into a write;
- create durable Memory without a Proposal.

Tool authorization is deterministic code outside the model. External destinations are allowlisted and previewed. Security tests include direct and indirect injection, encoded instructions, malicious documents, destination substitution, and data-exfiltration attempts.

## Production Agent Configuration

- Code execution: `off`.
- Product tools: versioned Planner AI Operations only.
- Client actions: ephemeral navigation/selection only, never durable writes.
- Source code, shell, filesystem, database tools, deployment, auth policy, and secret management: absent.
- Generated extensions and arbitrary outbound MCP: disabled.
- Conversation, Proposal, Memory, and tool metadata: canonical owner-scoped Supabase tables.
- Identity: verified Supabase user and server-derived Workspace; never browser-asserted email or owner ID.

## Evaluation Gates

No provider/model/prompt/schema change ships without fixtures for:

- valid structured output and malformed response handling;
- source precision and unsupported inference;
- Capture preservation and Proposal idempotency;
- cross-user and AI-Excluded retrieval denial;
- risk classification and approval behavior;
- prompt injection and secret exfiltration;
- timeout, retry, fallback, and provider outage;
- cost and context-size regression;
- coaching tone across calm, direct, and strict modes;
- high-risk content response within the accepted product safety scope.

Evaluation results are versioned. Human review samples use synthetic or explicitly consented content, never production data by default.

## Current Implementation Status

The product now implements authenticated and owner-scoped AI routes, bounded input and output schemas, database-backed quotas, privacy-safe errors, managed provider adapters, durable analysis jobs, proposal validation, and deterministic test suites. The uncalled standalone SMART endpoint has been removed; structured analysis must enter through an approved Operation or job contract.

The remaining AI release gates are tracked in the [status report](../status.md). They include a clean full live-provider corpus, canonical production migration and verification, provider budgets and monitoring, private attachment ingestion, trusted calendar and web context, and approved outbound MCP connections. These capabilities stay disabled until their privacy, injection, recovery, and cost gates pass.
