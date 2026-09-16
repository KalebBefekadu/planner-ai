# Architecture Foundation Handoff

- **Task:** `.agents/tasks/architecture-foundation.md`
- **Branch:** `codex/architecture-foundation`
- **Implementation commit:** `238eace`

## Behavior and decisions changed

- Integrated the accepted Knowledge/Planning two-pillar product shape without
  displacing the single-owner personal MVP or its dogfood gate.
- Sequenced simple shared Workspaces after dogfood, with the authorization seam
  allowed to harden earlier under unchanged owner-only behavior.
- Added measurable gates for EH-01 through EH-07 and linked them from the
  execution roadmap and architecture authority.
- Pinned Node 24.21.0 across local setup, package metadata, and CI; aligned
  `@types/node` with Node 24 and `eslint-config-next` with Next.js 16.3.4.

## Files changed

- `.agents/ACTIVE.md`
- `.agents/tasks/architecture-foundation.md`
- `.github/workflows/ci.yml`
- `.nvmrc`
- `docs/engineering/architecture.md`
- `docs/engineering/improvement-program.md`
- `docs/product/product-shape.md`
- `docs/product/vision.md`
- `docs/roadmap.md`
- `web/package.json`
- `web/package-lock.json`

## Verification

Run in `web/` with Node 24.21.0:

- `npm ci` — passed; 768 packages installed, 0 vulnerabilities.
- `npm run agent:check` — passed; formatting, ESLint, and TypeScript clean.
- `npm test` — passed; 78 files and 920 tests.
- Targeted Markdown Prettier check — passed.
- `git diff --check` — passed.

## Risks and follow-up

- GitHub Actions has not yet exercised the exact Node pin on this branch.
- The host's default Node is 25.8.1, so verification used a temporary Node
  24.21.0 runtime. Contributors should use `.nvmrc` or an equivalent version
  manager.
- The nominal `integration/dogfood` branch was 120 commits behind the audited
  `claude/dogfood-hardening` baseline when this task began; integration should
  resolve that branch drift before merging unrelated work.
- Database, RLS, service-role, observability, module-boundary, Operation, and
  durable-job changes remain deliberately outside this focused task.
