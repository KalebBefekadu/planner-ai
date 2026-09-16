# Reproducible Delivery Task

- **Goal:** prevent concurrent worktrees from mutating the same local Supabase
  stack and make checked-in database types verifiably derive from a clean
  migration reset.
- **Owner:** Codex lead
- **Branch:** `codex/reproducible-delivery`
- **Base:** `codex/architecture-foundation` at `da8f2fb`.
- **Dependencies:** EH-02 in `docs/engineering/improvement-program.md` and the
  existing local Supabase CLI configuration.
- **Writable paths:** `.agents/ACTIVE.md`, `.agents/README.md`,
  `.agents/tasks/reproducible-delivery.md`, the matching handoff,
  `.github/workflows/ci.yml`, `web/package.json`,
  `web/src/types/supabase.generated.ts`,
  `web/scripts/with-local-supabase-lock.sh`,
  `web/scripts/verify-local-database.sh`, and
  `web/tests/unit/local-supabase-lock.test.ts`.
- **Forbidden paths:** application source other than the mechanically generated
  Supabase contract, migrations, database tests, production data/configuration,
  credentials, deployment settings, and other worktrees.

## Deliverables

1. Add a repository-shared, fail-fast lock for commands that use the fixed local
   Supabase project and ports.
2. Add a database verification command that holds the lock while it starts the
   stack, resets from migrations, runs pgTAP, regenerates formatted types into a
   temporary file, and checks for drift without modifying the worktree.
3. Make the explicit type-generation command hold the same lock and reset from
   migrations before replacing the generated file.
4. Reconcile any generated-type drift demonstrated by that clean reset.
5. Route CI database verification through the same checked-in command and
   document the local concurrency rule.
6. Add focused automated coverage for lock exclusion, ownership diagnostics,
   cleanup, and command exit-code propagation.

## Acceptance

- A second worktree command cannot enter the local Supabase critical section
  while the first holds it and receives actionable owner information.
- The lock is released after success and failure.
- `npm run verify:db` proves migrations, pgTAP, and generated types from one
  clean reset and leaves the worktree unchanged.
- `npm run types:generate` cannot introspect an unknown partially migrated local
  database.
- CI no longer contains an independently maintained database/type command
  sequence.
- `npm run agent:check`, `npm test`, and the database verification pass.

## Verification

Run from `web/` with Node 24.21.0:

```bash
npm ci
npm run agent:check
npm test
npm run verify:db
```

## Handoff

`.agents/handoffs/reproducible-delivery.md`
