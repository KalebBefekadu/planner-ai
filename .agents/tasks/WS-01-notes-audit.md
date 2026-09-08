# WS-01: Notes convergence audit

## Owner

Claude, independent audit worker.

## Goal

Map the real authenticated Notes experience against the accepted Preview workspace design so Codex can migrate it without duplicating fixture-backed implementation.

## Writable paths

- `.agents/reports/WS-01-notes-audit.md`

## Forbidden paths

- All application source, tests, migrations, generated files, lockfiles, CI, roadmap, and status files.

## Required analysis

- Read `docs/roadmap.md`, `docs/status.md`, `.agents/README.md`, and this contract first.
- Compare the real Notes routes/components with the Preview workspace/editor components.
- Classify accepted Preview elements as reuse, rebuild, or discard.
- Identify the real loaders, Operations, authorization boundaries, editor state, import/export, and recovery behavior that must remain authoritative.
- Recommend the smallest implementation slice that materially advances the Notion-replacement goal.
- Include exact file references, responsive/accessibility risks, likely tests, and any collision-sensitive shared files.

## Acceptance

- The report is concise, implementation-ready, and does not propose work outside roadmap stage 2.
- No source file is modified.
- The report ends with a handoff containing checks, risks, and the commit SHA.
