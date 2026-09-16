# Architecture Foundation Task

- **Goal:** integrate the accepted two-pillar product shape with the existing
  personal-MVP roadmap, record the seven engineering outcomes, and complete the
  first low-risk runtime/toolchain alignment.
- **Owner:** Codex lead
- **Branch:** `codex/architecture-foundation`
- **Base:** `claude/dogfood-hardening` at task start because the nominal
  `integration/dogfood` branch was 120 commits behind the audited baseline.
- **Dependencies:** the user's decision to keep the personal MVP single-owner,
  prepare the authorization seam during hardening, and add shared Workspaces
  after dogfood.
- **Writable paths:** `docs/product/product-shape.md`,
  `docs/engineering/improvement-program.md`, `docs/roadmap.md`,
  `docs/product/vision.md`, `docs/engineering/architecture.md`, `web/package.json`,
  `web/package-lock.json`, `.nvmrc`, `.github/workflows/ci.yml`,
  `.agents/tasks/architecture-foundation.md`, and the matching handoff.
- **Forbidden paths:** application source, Supabase migrations and tests,
  production data/configuration, credentials, deployment settings, and other
  agents' worktrees.

## Deliverables

1. Preserve and commit `product-shape.md` as product context subordinate to the
   roadmap.
2. Resolve the shared-Workspace sequencing conflict without weakening the
   single-owner personal MVP.
3. Record EH-01 through EH-07, stack corrections, and final-product preparation
   with measurable gates.
4. Pin the supported Node LTS version across local setup, package metadata, and
   CI; align Node type definitions and Next.js lint configuration with it.
5. Leave later database, security, UI, observability, and job work as separately
   assignable focused tasks.

## Acceptance

- Roadmap, vision, architecture, and product-shape language no longer disagree
  about the current audience or shared-Workspace timing.
- The improvement program does not create a competing execution order.
- Package and lockfile versions agree.
- `npm run agent:check` and `npm test` pass.

## Verification

Run from `web/`:

```bash
npm ci
npm run agent:check
npm test
```

## Handoff

`.agents/handoffs/architecture-foundation.md`
