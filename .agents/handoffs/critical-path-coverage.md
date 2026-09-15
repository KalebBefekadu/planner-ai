# Critical Path Coverage Handoff

- **Task:** `.agents/tasks/critical-path-coverage.md`
- **Branch:** `codex/critical-path-coverage`
- **Base:** `codex/supply-chain-hardening` at `9b902bc`

The fourth and last stack-hardening item. **The stack hardening set is now
complete.**

## Behavior changed

None in the product.

## The decision, and why it is narrow

A coverage threshold over a whole repository gets optimised around: people
write tests for whatever is cheapest to cover until the number goes green, and
the number then says nothing about whether the code that matters is tested. So
there is one floor, on one path.

`src/lib/operations` is where every durable mutation in the product goes
through — idempotency, optimistic concurrency, receipts, undo, and the message
a person is shown when any of it fails. A regression there is silent and
corrupts data rather than breaking a screen. Nothing else carries a floor, on
purpose.

The owner chose this path; the undo, import-parser and auth boundaries were
offered and not taken. If that changes, the config is one glob per path.

## The floors

| Measure | Floor | Actual |
| --- | --- | --- |
| Statements | 90% | 92.68% |
| Branches | 85% | 88.02% |
| Functions | 95% | 100% |
| Lines | 90% | 91.89% |

Set just under what the suite achieves, so they ratchet rather than describe an
aspiration. Raise them when the real figure moves; do not lower one to make a
change fit.

## What measuring found

`src/lib/operations/failure-message.ts` had **zero** coverage and is imported by
fifteen components — every surface that shows a person an error.

It is not incidental code. A production build strips the message off any error
thrown out of a Server Action, so `error.message` on the client is a generic
React error; the real message travels on the digest instead. The function exists
to tell those apart, and **the branch it exists for is the one that never runs
locally** — every development run takes the path that works.

Twelve tests now cover it and the two digest readers beneath it, including a
message containing a colon, a digest that is not code-prefixed, and both shapes
a stripped production message takes. That moved the path from 80.48% statements
to 92.68% and functions from 80% to 100%, which is where the floors come from.

## Enforcement proven

`npm run test:coverage` is a script rather than a flag someone has to remember,
and CI runs it in the application job beside `npm test`.

Raising the statement floor to an unreachable 99% makes it exit 1 with
`Coverage for statements (92.68%) does not meet "src/lib/operations/**"
threshold (99%)`. At the real floor it exits 0. A threshold that has not been
seen to fail is not a threshold.

## Files changed

- `.agents/ACTIVE.md`
- `.agents/tasks/critical-path-coverage.md`
- `.agents/handoffs/critical-path-coverage.md`
- `.github/workflows/ci.yml`
- `web/package.json`, `web/package-lock.json`
- `web/vitest.config.ts`
- `web/tests/unit/operation-failure-message.test.ts` (new)

`@vitest/coverage-v8` is added exactly pinned as a dev dependency. It does not
reach the production closure, and the generated dependency inventory is
unchanged — confirmed by regenerating it.

## Verification

Run in `web/` with Node 24.21.0:

- `npm ci` — passed; 0 vulnerabilities.
- `npm run agent:check` — passed.
- `npm test` — passed; 87 files, 1,006 tests, up from 86 and 994.
- `npm run test:coverage` — passed, thresholds met.
- `npm run build` — passed.
- `npm audit --audit-level=high` — 0 vulnerabilities.
- Threshold deliberately raised out of reach and confirmed to fail, as above.

## Risks and follow-up

- A floor on one path is a deliberate statement that the rest is unmeasured, not
  that the rest is fine. It should not be read as a quality bar for the
  repository.
- `index.ts` is 1,335 lines and carries most of the remaining uncovered
  branches. Splitting it — the Operation manifest, the executor, the failure
  mapping — would make both the coverage figure and the file easier to reason
  about, and it overlaps with EH-04's manifest work rather than being separate
  from it.
- Coverage runs as a second vitest pass rather than being folded into
  `npm test`, so the suite executes twice in CI. That is a few seconds and
  keeps local iteration fast; fold them together if CI time ever matters.
