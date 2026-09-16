# Content-Free Telemetry Handoff

- **Task:** `.agents/tasks/content-free-telemetry.md`
- **Branch:** `codex/content-free-telemetry`
- **Base:** `codex/durable-job-model` at `d2b71f7`

First slice of EH-06, and deliberately the half that does not need production
traffic to be worth anything.

## What this is, and what it is not

EH-06 has two halves. Tracing, spans, SLO dashboards and alerts want a running
system with real traffic; building them now would be furniture for a room nobody
is in yet. **The other half is a guarantee**, and a guarantee can be made true
before there is anything to observe:

> every critical production failure can be located by stable request or receipt
> ID **without placing Note, Capture, prompt, transcript, filename, or secret
> content in telemetry**

That is what this branch makes enforceable. The dashboards can come later and
will have a boundary to respect when they do.

## What the audit found

**No leak.** Stated plainly because it is the finding, not a preamble to one.

- Seven `console.*` calls in the whole of `src`. The two on the AI paths were
  already exemplary: structured JSON carrying `event`, `operation`,
  `requestId`, `errorCode` and `errorClass` — the error's *class name*, never
  its message.
- The telemetry tables — `activity_events`, `ai_usage_events`,
  `lifecycle_job_runs`, `ai_jobs` — are ids, enums, stable codes and numbers.
  Nothing content-bearing.
- `operation_receipts.result_json` and `.undo_payload_json` do hold prior state,
  because undo cannot work without it. They are not telemetry: all four tables
  force row level security, and the only reader is the owner's own conversation
  export. Nothing logs them and nothing ships them off-box.

So the guarantee held. It held **by care**, at seven call sites, with nothing
stopping the next `console.error('Could not save', note.title)`.

## One thing tightened

`handleUncaughtException` logged `error.message` verbatim on the non-fatal path.
The predicate only admits five fixed messages and a few codes, so it was bounded
in practice — but bounded by a predicate somebody could widen, not by the shape
of what is written. It now reports **which signature matched**
(`clientDisconnectSignature`), which is content-free by construction and is the
more useful signal anyway: you learn that it was `ECONNRESET`, not that some
socket said something.

## What is now enforced

- `web/src/lib/api/telemetry.ts` — one emitter, `recordServerEvent`, taking a
  closed field set. Every field is an identifier, an enum, a stable code or a
  number. **There is no free-form string field to put content into**: the
  guarantee is a type, not a convention.
- `web/tests/unit/content-free-telemetry.test.ts` freezes the list of files
  allowed to write a log line at all, the same shape as the admin-client
  boundary that worked well for EH-01.

Proven by violating it: a planted `console.error('Could not save', 'a real note
title')` in `src/app/notes/actions.ts` fails the test, naming the file.

## The one honest exception

`installClientDisconnectGuard` still prints the whole error before ending the
process on a fault it does not recognise, and that is left alone on purpose. A
crash is exactly when the stack is worth having, a content-free line would
destroy the only diagnosis available, and **Node prints an uncaught exception to
stderr anyway** — removing it would close the usefulness, not the hole.

What that means is written into the test rather than quietly allowed: whatever
collects stderr in production can receive a raw error on a crash. That is a fact
to weigh when choosing a log drain. A second assertion pins the exception to the
fatal branch only, so it cannot grow to cover the ordinary disconnect path.

## Files changed

- `.agents/ACTIVE.md`, the task and this handoff
- `web/src/lib/api/telemetry.ts` (new)
- `web/tests/unit/content-free-telemetry.test.ts` (new)
- `web/src/lib/api/client-disconnect.ts`, `client-disconnect-guard.ts`
- `web/src/lib/api/ai-route.ts`, `lifecycle-job.ts`
- `web/tests/unit/client-disconnect.test.ts` — the warn contract changed

## Verification

Run in `web/` with Node 24.21.0:

- `npm run agent:check` — passed.
- `npm test` — passed; 88 files, 1,013 tests, up from 87 and 1,006.
- `npm run verify:db` — passed.
- `npm run build` — passed.
- Boundary deliberately violated and confirmed to fail, as above.

## Risks and follow-up

- `telemetry.ts` deliberately omits `import 'server-only'`. That guard would
  make the module unimportable from a unit test, and `errorClassOf` is a pure
  function whose behaviour is the point. The boundary test is what keeps logging
  server-side, which is stronger than an import that only fails in a browser
  bundle.
- **The rest of EH-06 is untouched**: no spans, no exporter, no SLO dashboards,
  no alerting on Operation latency, migration mismatch, provider failure, stuck
  jobs, backup freshness or restore evidence. Those want traffic, and the
  correlation story they need — browser-safe request id to server trace to
  Operation receipt to lifecycle run — already has its ids in place, which is
  the part that is hard to retrofit.
- A stuck deletion request is now visible in the data (`attempt_count`,
  `reclaimed`) but nothing surfaces it. That alert is the natural first thing to
  build once there is somewhere to send it.
