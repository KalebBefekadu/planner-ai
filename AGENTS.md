# Planner AI Agent Instructions

These instructions apply to every coding agent working in this repository.

## Authorities

Read these before changing code:

1. `docs/roadmap.md` - current goal, scope, order, and definition of done.
2. `docs/status.md` - verified facts and open gaps.
3. `.agents/README.md` - multi-agent ownership and handoff protocol.
4. `.agents/ACTIVE.md` - the only currently assigned work.

If documents conflict, the roadmap controls delivery order, status controls factual claims, and the active task controls file ownership.

## TokenSave First

Before broad code reading or repository scans, use the TokenSave MCP tools. Use targeted `rg` and file reads only when the graph does not answer the question. Do not repeat research already captured in the authorities.

## Work Rules

- Work only on the assigned task and within its writable paths.
- Never edit another agent's worktree.
- Never commit directly to `main` or `integration/dogfood` from a worker worktree.
- Do not add behavior to `/preview`; it may change only while extracting shared components or removing superseded fixtures.
- Preserve user input and existing unrelated changes.
- Use existing patterns and versioned Operations for durable mutations.
- Do not read, copy, print, or commit local environment secrets.
- Do not modify production data, deployment settings, credentials, billing, or destructive migrations without explicit approval.
- Make conservative implementation decisions autonomously. If blocked, record the exact blocker and continue with another unblocked item inside the assigned task.

## Verification

Run the smallest meaningful checks while iterating. Before handoff, run:

```bash
cd web
npm run agent:check
```

Run affected browser or database tests when the task touches those contracts. Broad suites run at roadmap stage gates or when shared contracts change.

## Handoff

Leave the branch with focused commits and a clean worktree. The handoff must state:

- behavior changed;
- files changed;
- checks run and results;
- known risks or blockers;
- commit SHA.

The integration agent reviews and merges. Worker agents never merge their own work.
