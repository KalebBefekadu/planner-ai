# Planner AI Provider Register

Status date: 2026-08-21. Review this register before changing a model, provider, price version, data category, or retention setting.

## Approved Provider

| Field                 | Approved value                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Provider              | GroqCloud                                                                                                                        |
| Planner AI roles      | Agent, structured analysis, and transcription                                                                                    |
| Text model            | `openai/gpt-oss-120b`                                                                                                            |
| Transcription model   | `whisper-large-v3-turbo`                                                                                                         |
| Credentials           | Server-managed `GROQ_API_KEY`; never browser-, model-, Activity-, or telemetry-visible                                           |
| Data categories       | User-requested planning text and bounded Workspace context for text roles; user-submitted audio for transcription                |
| Prohibited data       | AI-excluded Notes unless explicitly attached for one interaction; secrets; service-role credentials; unrelated Workspace content |
| Processing region     | Provider documents retained customer data in United States GCP buckets                                                           |
| Default retention     | Inference is not retained by default; reliability or abuse logs may retain inputs and outputs for up to 30 days                  |
| Zero Data Retention   | Eligible and required before external beta; dashboard verification remains an external release gate                              |
| Training              | No Planner AI training use is authorized                                                                                         |
| Application telemetry | Content-free request metadata only, retained for 90 days                                                                         |

## Price Version `2026-08-17-gpt-oss-120b`

| Model                        | Unit price used by Planner AI                                  |
| ---------------------------- | -------------------------------------------------------------- |
| `openai/gpt-oss-120b` input  | $0.15 per million tokens                                       |
| `openai/gpt-oss-120b` output | $0.60 per million tokens                                       |
| `whisper-large-v3-turbo`     | $0.04 per audio hour, with a 10-second minimum billed duration |

Each usage event retains `model_id`, `pricing_version`, token or audio units, and the resulting integer-microdollar estimate. A later price change creates a new price version and never rewrites historical estimates.

## Approved Feature Inventory

| Capability          | Provider role       | Bounded provider input                                                                                      | Output ceiling                        | Extra confirmation                                                             |
| ------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| Assistant           | Agent               | One 4,000-character message, up to 8,000 characters across 8 recent turns, and minimized Workspace metadata | 1,000 tokens                          | Write Proposals always require approval                                        |
| Goal analysis       | Structured analysis | One 1,000-character Goal                                                                                    | 1,200 tokens                          | None                                                                           |
| Vision questions    | Structured analysis | One 8,000-character Vision draft                                                                            | 1,200 tokens                          | None                                                                           |
| Capture analysis    | Structured analysis | One immutable Capture plus bounded Goal and Note metadata                                                   | 2,400 tokens                          | A Capture over 12,000 characters requires a second explicit click              |
| Review analysis     | Structured analysis | One period plus at most 40 Actions, 20 Goals, and 8 completed Review records                                | 2,000 tokens                          | Advice remains non-writing; weekly priorities only populate visible checkboxes |
| Voice transcription | Transcription       | One allowlisted audio file up to 25 MB                                                                      | 60,000-character validated transcript | Recording/upload is user initiated                                             |

The `openai/gpt-oss-120b` pin replaced the unavailable `llama-3.3-70b-versatile` pin on 2026-08-17. The maintained fourteen-case assistant gate targets the compact, budget-bounded `assistant-v11` prompt and covers recurring Action creation/materialization, notification dismissal, reviewed Capture Proposal approval, and exact claim-level evidence. Version 11 adds deterministic route scopes, an 8,000-character cap for explicitly selected AI-visible Note bodies, at most eight recent history messages within the same 8,000-character budget, at most one owner-scoped exact-read or bounded literal-search Operation, deterministic high-risk safety interception, explicit Capture/Memory intent routing, and a provider-compatible response schema before the strict application validator. Assistant replies are capped at 1,000 completion tokens before strict application validation. A separate three-case read gate checks exact search, exact record selection, and write/read confusion. A six-case structured-analysis gate exercises explicit and ambiguous Captures, destructive instruction injection, exact weekly Review priorities and citations, the non-weekly priority boundary, and invented-record injection. Capture organization uses `capture-analysis-v2`; Review advice uses `review-analysis-v1`. Production routes and live tests share prompt builders, tool schemas, strict validators, and the fixed `data_only` envelope. Assistant full-prompt calls are spaced by 45 seconds to stay clear of the configured 8,000-token-per-minute account limit under variable output size; the smaller structured-analysis calls remain spaced by 32 seconds.

## Agent Fallback Candidate

| Field             | Candidate value                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider          | OpenAI API                                                                                                                                                      |
| Planner AI role   | Agent only; structured analysis and transcription remain Groq-only                                                                                              |
| Model             | `gpt-5-mini-2025-08-07`                                                                                                                                         |
| SDK               | Exactly pinned `openai@7.5.0`                                                                                                                                   |
| Price version     | `2026-08-21-gpt-5-mini-2025-08-07`: $0.25 input and $2.00 output per million tokens                                                                             |
| Activation        | Disabled unless `AI_AGENT_FALLBACK_PROVIDER=openai` and a server-only `OPENAI_API_KEY` are both present                                                         |
| Eligible failures | Primary-provider timeout, throttling, connection failure, or 5xx only; authentication, authorization, invalid input, and invalid model output never fail over   |
| Request boundary  | Reuses the exact `assistant-v11` prompt, tool schemas, context minimization, AI Exclusions, output validator, approval policy, and output ceiling               |
| Persistence       | Chat Completions with `store: false`; Planner AI sends no files, audio, hosted tools, remote MCP calls, or provider-side Conversation state                     |
| Release state     | Implemented and deterministically tested, but disabled until the full assistant and read live corpora pass and production retention/spend controls are verified |

OpenAI states that API data is not used for training unless the customer opts in. Default abuse-monitoring logs may retain prompts and responses for up to 30 days; approved Zero Data Retention or Modified Abuse Monitoring changes that boundary. Chat Completions has no application-state retention by default and is eligible for Zero Data Retention, subject to documented limitations. Planner AI therefore requires project-level retention verification before enabling this candidate for beta. See [GPT-5 mini capabilities and pricing](https://developers.openai.com/api/docs/models/gpt-5-mini) and [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data#default-usage-policies-by-endpoint).

On 2026-08-21 and 2026-08-22, the complete three-case assistant-read gate and six-case Capture/Review gate passed against Groq. Early full `assistant-v11` runs exposed and drove fixes for read/Proposal confusion, Capture/Memory intent routing, and legacy-mode Proposal enforcement. The latest all-14 process passed twelve fixtures and received provider 429 responses for the last two; both skipped fixtures pass minimized live regressions with the same canonical schema. Every fixture therefore has individual passing evidence, but targeted runs do not substitute for one clean all-14 release-gate process. Deterministic schema and behavioral evaluation continues to reject malformed output, guessed writes, invalid or excessive reads, invented evidence or priorities, destructive injection, canary leakage, and legacy-mode proposals.

Provider degradation never switches models without an explicit evaluated configuration. The currently approved Groq-only path returns stable `provider_timeout`, `provider_rate_limited`, `provider_unavailable`, or `invalid_provider_output` states and falls back to the ordinary click-first product. When the OpenAI agent candidate is explicitly activated after its release gates pass, only transient agent failures may fail over; a multi-call tool turn remains on one provider. Assistant, Socratic, transcription, and Capture analysis retry from preserved source input. Capture analysis additionally records content-free durable job status and rejects publication from an older request after a newer retry begins.

Provider request normalization is explicit. Groq tool turns disable parallel tool calls and omit provider JSON mode because Groq documents structured-output/tool-use incompatibility. Planner AI instead adds a schema-guided final-response function alongside read tools, strips unsupported JSON Schema keywords, and normalizes that function result back to ordinary completion content before the strict Zod and per-Operation validators run. OpenAI agent turns use the same managed response schema, force `store: false`, and omit the sampling parameter unsupported by the pinned reasoning model. See [Groq local tool calling](https://console.groq.com/docs/tool-use/local-tool-calling) and [Groq structured outputs](https://console.groq.com/docs/structured-outputs).

## Controls

- Per-minute database quotas apply before provider invocation.
- The Workspace dashboard exposes current-month request, reliability, latency, unit, and estimated-cost totals for all six capabilities.
- The owner controls a $1 to $20 monthly soft-budget warning threshold through a versioned Operation.
- A fixed $20 monthly platform cap blocks further provider requests. Canonical requests reserve conservative content-free cost ceilings by request ID before provider invocation so concurrent calls cannot reserve beyond the cap; completed usage reconciles the reservation and abandoned reservations expire after 15 minutes.
- Per-minute throttling and the monthly platform cap return distinct stable states.
- Capture analysis over 12,000 characters requires explicit confirmation before quota consumption or durable job creation.
- Agent calls time out after 30 seconds with one bounded retry; structured analysis uses 20 seconds with one retry; transcription uses 55 seconds without an automatic retry.
- Provider failure never blocks click-first planning, Notes, exact search, or raw Capture storage.
- Operational records contain no prompts, outputs, filenames, Note titles, transcript text, or raw user identifiers.

## Required External Verification

- Enable and capture evidence of Groq Zero Data Retention for the production organization.
- Confirm billing spend limits and model permissions in the production Groq project.
- Recheck prices, retention, data location, subprocessors, and model lifecycle before beta and at least quarterly.
- Complete a provider outage drill and verify that the click-first product remains available.
- Before enabling the OpenAI agent fallback, pass the full `assistant-v11` and assistant-read live corpora on OpenAI, verify project retention and spend limits, and record the result here.

## Sources

- [Groq supported models and current prices](https://console.groq.com/docs/models)
- [Groq customer-data retention, ZDR, and data location](https://console.groq.com/docs/your-data)
- [Groq transcription pricing and minimum billed duration](https://console.groq.com/docs/speech-to-text)
