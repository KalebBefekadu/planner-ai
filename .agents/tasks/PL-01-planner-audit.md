# PL-01: Planner convergence audit

## Owner

Claude, independent read-only audit worker.

## Goal

Compare the authenticated Planner daily loop with the accepted Preview Planner screen and identify the smallest implementation slice that materially improves daily dogfooding without changing data contracts.

## Writable paths

- `.agents/reports/PL-01-planner-audit.md`

## Forbidden paths

- All application source, tests, migrations, generated files, lockfiles, CI, roadmap, and status files.

## Required analysis

- Read `AGENTS.md`, `docs/roadmap.md`, `docs/status.md`, `.agents/README.md`, and this contract first.
- Compare real `/planner`, `/today`, `/calendar`, and review flows with the accepted Preview Planner experience.
- Preserve canonical loaders, authorization, versioned Operations, Activity, undo, failure states, and accessibility behavior.
- Classify accepted Preview patterns as reuse, rebuild, or discard.
- Recommend one small implementation ticket with exact files, tests, responsive risks, and collision-sensitive paths.
- Do not propose Graph, Canvas, databases, collaboration, plugins, broad MCP, or speculative AI work.

## Acceptance

- The report is concise and implementation-ready.
- No product source is modified.
- The report ends with behavior changed, files changed, checks, risks, and commit SHA.
