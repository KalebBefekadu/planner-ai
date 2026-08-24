---
status: accepted
---

# Keep the core reliable without AI

Core authenticated planning Operations have a beta objective of 99.5 percent monthly availability, excluding announced maintenance, and a p95 latency target below 750 ms for ordinary Operations. Successful writes are durably stored, retries are idempotent, and unsent Capture input survives interruption. AI and transcription are measured separately: provider failure must not disable click-first planning, Notes, exact search, or raw Capture creation.

Operational telemetry is always available but content-free. Product-behavior analytics is opt-in during beta, raw events expire after 90 days, and temporary diagnostic sharing requires explicit user action.

## Consequences

- AI jobs expose status and safe retry, preserve source input, and may use only evaluated fallbacks.
- Operational events may include Operation, result, latency, error, provider class, cost totals, and pseudonymous identity, but not personal content or filenames.
- Reliability targets, error budgets, degradation tests, and incident procedures are release artifacts rather than informal aspirations.
