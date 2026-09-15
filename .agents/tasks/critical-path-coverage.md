# Critical Path Coverage Task

- **Goal:** close the last stack-hardening item with a coverage floor on the
  Operation execution path, and on nothing else.
- **Owner:** Codex lead
- **Branch:** `codex/critical-path-coverage`
- **Base:** `codex/supply-chain-hardening` at `9b902bc`.
- **Writable paths:** `.agents/ACTIVE.md`,
  `.agents/tasks/critical-path-coverage.md`, the matching handoff,
  `.github/workflows/ci.yml`, `web/package.json`, `web/package-lock.json`,
  `web/vitest.config.ts`, and `web/tests/unit/operation-failure-message.test.ts`.
- **Forbidden paths:** application code, database migrations, production
  configuration/data/credentials, deployment settings, and other worktrees.

## The decision

One floor, on `src/lib/operations`, chosen by the owner from four candidates.
A threshold over the whole repository gets optimised around and then says
nothing about whether the code that matters is tested.

## Deliverables

1. Floors set just under today's measured figures, so they ratchet.
2. A `test:coverage` script, run by CI beside `npm test`.
3. Coverage for whatever measuring exposes as untested on that path.
4. The floor demonstrated to fail, not assumed to.

## Acceptance

- No product behaviour changes, and the coverage provider stays a dev
  dependency that does not reach the production closure.
- `npm run agent:check`, `npm test`, `npm run test:coverage`, `npm run build`
  and `npm audit --audit-level=high` pass under Node 24.21.0.

## Verification

Run from `web/` with Node 24.21.0:

```bash
npm ci
npm run agent:check
npm test
npm run test:coverage
npm run build
npm audit --audit-level=high
```

## Handoff

`.agents/handoffs/critical-path-coverage.md`
