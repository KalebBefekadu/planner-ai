# BR-01: Real-Shell Audit

Status: **active**

Owner: Claude

Mode: independent read-only product and code audit

Branch: `claude/br-01-shell-audit`

Base: `integration/dogfood`

## Goal

Map the accepted Workspace and Planner Preview experience to the real authenticated shell so the next implementation replaces the correct components once.

## Writable Paths

- `.agents/reports/BR-01-claude-audit.md`

## Forbidden Paths

- `web/**`
- `docs/**`
- migrations, generated files, lockfiles, workflows, and environment files

## Deliverable

The report must include:

1. current real shell entry points and ownership;
2. Preview elements mapped to reuse, rebuild, or discard;
3. duplicate tokens, layout systems, and navigation implementations;
4. proposed shared component boundaries and typed view-model boundaries;
5. migration order that keeps authenticated routes working;
6. likely collision points and regression risks;
7. focused tests and desktop/mobile visual baselines needed for the first implementation.

Use file and line references. Do not change product code.

## Acceptance

- Workspace and Planner are both covered.
- Fixture data is clearly separated from authenticated loaders and Operations.
- The recommendation produces one shared frame without making Preview a production dependency.
- Every proposed first-step code change names its affected files.

## Handoff

Commit the report and provide its commit SHA. The Codex lead reviews it before activating implementation.
