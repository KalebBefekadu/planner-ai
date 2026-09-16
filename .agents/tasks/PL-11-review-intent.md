# PL-11 Review Submission Intent

Owner: Codex lead. Branch: `codex/pl-11-review-intent`. Issue: #158.

Writable: `web/src/app/review/actions.ts`, weekly/period review components,
`web/src/lib/reviews/submission.ts`, focused review unit/browser tests,
this contract and `.agents/ACTIVE.md`.

No Notes, shared styles, migrations, generated types, secrets or production changes.
Claude owns independent Notes work. Keep existing Operations and receipt history.

Acceptance: unchanged retries reuse an intent; changed payloads cannot replay old
success; complete/undo/complete saves a new review; completed weekly reviews load
as saved records. Run agent:check and focused regression tests. Open a PR for
integration; report any unverified browser or concurrency cases explicitly.
