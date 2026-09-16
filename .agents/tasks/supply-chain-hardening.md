# Supply Chain Hardening Task

- **Goal:** close three of the four remaining stack-hardening items: pin direct
  production and security-sensitive packages, pin CI actions to reviewed SHAs,
  and generate a release dependency inventory.
- **Owner:** Codex lead
- **Branch:** `codex/supply-chain-hardening`
- **Base:** `codex/operation-contract-manifest` at `95ab836`.
- **Dependencies:** none beyond the existing lockfile and workflows.
- **Writable paths:** `.agents/ACTIVE.md`,
  `.agents/tasks/supply-chain-hardening.md`, the matching handoff, the package
  count in existing handoffs, `.github/workflows/ci.yml`,
  `.github/workflows/secret-scan.yml`,
  `docs/engineering/dependency-inventory.md`, `web/package.json`,
  `web/package-lock.json`, `web/scripts/dependency-inventory.mjs`,
  `web/scripts/generate-dependency-inventory.mjs`, and
  `web/tests/unit/supply-chain.test.ts`.
- **Forbidden paths:** application code, database migrations, production
  configuration/data/credentials, deployment settings, and other worktrees.

## Deliverables

1. Every `uses:` in every workflow pinned to a commit, with its release in a
   comment so the pin stays reviewable.
2. Direct production dependencies that hold a credential, speak to the network,
   or parse input a person did not write pinned to exact versions, with no
   change to what is installed.
3. A release dependency inventory generated from the lockfile alone, so it is
   identical on every platform.
4. Guards for all three, each demonstrated by breaking it.

## Acceptance

- No product behaviour changes, and no `version`, `resolved` or `integrity`
  line changes in the lockfile.
- `npm run agent:check`, `npm test`, `npm run build`, and
  `npm audit --audit-level=high` pass under Node 24.21.0.

## Verification

Run from `web/` with Node 24.21.0:

```bash
npm ci
npm run agent:check
npm test
npm run build
npm audit --audit-level=high
```

## Handoff

`.agents/handoffs/supply-chain-hardening.md`
