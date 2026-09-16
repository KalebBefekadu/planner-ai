# Content-Free Telemetry Task

- **Goal:** make EH-06's content-free guarantee enforceable, ahead of any
  tracing or dashboards.
- **Owner:** Codex lead
- **Branch:** `codex/content-free-telemetry`
- **Base:** `codex/durable-job-model` at `d2b71f7`.
- **Writable paths:** `.agents/ACTIVE.md`, this contract, the matching handoff,
  `web/src/lib/api/telemetry.ts`, `web/src/lib/api/client-disconnect.ts`,
  `web/src/lib/api/client-disconnect-guard.ts`, `web/src/lib/api/ai-route.ts`,
  `web/src/lib/api/lifecycle-job.ts`,
  `web/tests/unit/content-free-telemetry.test.ts`, and
  `web/tests/unit/client-disconnect.test.ts`.
- **Forbidden paths:** database migrations, application routes, production
  configuration/data/credentials, and other worktrees.

## Deliverables

1. An audit of what the server records today, stated plainly whether or not it
   finds a leak.
2. One emitter whose input is a closed set of identifiers, enums, stable codes
   and numbers, with no free-form string field.
3. A boundary test freezing which files may write a log line, with every
   exception named and reasoned.
4. The boundary demonstrated to fail on a planted leak.

## Acceptance

- No behaviour change beyond the shape of what is logged.
- `npm run agent:check`, `npm test`, `npm run verify:db` and `npm run build`
  pass under Node 24.21.0.

## Handoff

`.agents/handoffs/content-free-telemetry.md`
