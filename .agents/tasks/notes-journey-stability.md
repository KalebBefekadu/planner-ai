# Notes Journey Stability

- Owner: Codex
- Branch: `codex/notes-journey-stability`
- Base: `integration/dogfood` at `4dd1e87`
- Goal: turn the two retry-dependent Notes journeys into deterministic evidence: immediate navigation during autosave and favorite persistence on mobile.
- Writable paths:
  - `web/tests/e2e/journey-notes.spec.ts`
  - `web/tests/e2e/support/workspace.ts`
  - `web/src/lib/notes/use-note-draft.ts`
  - focused Notes test files if a reproduced product defect requires them
  - `.agents/ACTIVE.md`
  - `.agents/tasks/notes-journey-stability.md`
  - `.agents/handoffs/notes-journey-stability.md`
- Forbidden: schema, migrations, production data/configuration, broad Playwright timeout increases, and unrelated Notes behavior.
- Acceptance:
  - reproduce or decisively isolate each reported flake with retries disabled;
  - fix the causal race rather than masking it with retries or arbitrary sleeps;
  - run each affected journey repeatedly on its failing browser project;
  - run `npm run agent:check`, the full unit suite, and the affected browser journeys.
