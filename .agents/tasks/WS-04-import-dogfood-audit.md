# WS-04: Import dogfood audit

## Owner

Claude, independent read-only audit worker.

## Goal

Identify the smallest remaining product change needed for the owner to safely import a representative Notion export and understand exactly what happened.

## Writable paths

- `.agents/reports/WS-04-import-dogfood-audit.md`

## Forbidden paths

- All application source, tests, migrations, generated files, lockfiles, CI, roadmap, and status files.

## Required analysis

- Read `AGENTS.md`, `docs/roadmap.md`, `docs/status.md`, `.agents/README.md`, and this contract first.
- Trace the real onboarding/import UI, preflight, dry run, commit, item-level reporting, duplicate handling, retry, unsupported-content reporting, export, and restore evidence.
- Separate already-verified behavior from remaining owner-facing gaps.
- Recommend exactly one small implementation ticket on the private-dogfood critical path.
- Preserve canonical authorization, Operations, import identity, hierarchy, sibling order, AI exclusion, and source-authoritative Markdown.
- Include exact files, focused tests, responsive/accessibility risks, and collision-sensitive paths.

## Acceptance

- The report is concise, evidence-based, and implementation-ready.
- No product source is modified.
- The report ends with behavior changed, files changed, checks, risks, and commit SHA.
