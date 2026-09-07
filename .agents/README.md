# Planner AI Multi-Agent Protocol

This directory coordinates Codex and Claude without sharing a checkout or editing the same files.

## Roles

- **Codex lead:** owns the roadmap, task contracts, architecture decisions, integration branch, conflict resolution, and final verification.
- **Codex worker:** implements the active UI or product slice in an isolated worktree.
- **Claude worker:** performs an independent audit or implements a separately owned slice in an isolated worktree.

Two workers may run together only when their writable paths do not overlap. One database-migration owner is allowed at a time.

## Branches

- `main`: completed, reviewed work.
- `integration/dogfood`: staging point for the current roadmap stage.
- `codex/<ticket>`: isolated Codex work.
- `claude/<ticket>`: isolated Claude work.

Workers target `integration/dogfood`. The Codex lead merges integration into `main` only after the stage gate passes.

## Task Lifecycle

1. The Codex lead writes one contract in `.agents/tasks/` and updates `.agents/ACTIVE.md`.
2. The contract names one owner, one branch, writable paths, forbidden paths, dependencies, acceptance criteria, and verification.
3. `scripts/agents/create-worktree.sh` creates the branch and isolated checkout.
4. The worker completes the task without changing its scope, commits, and records a handoff.
5. The Codex lead reviews the diff, runs integration checks, and merges in dependency order.
6. The lead marks the task complete and activates the next roadmap ticket.

## Collision Rules

- Shared shell, global styles, generated types, lockfiles, migrations, and CI have one writer at a time.
- Reviewers do not edit source files.
- A worker that discovers required changes outside its writable paths records them in the handoff.
- Workers rebase on `integration/dogfood` before handoff; the lead resolves conflicts.
- Each worktree uses its own development port and local test state.
- Production credentials remain only in the primary protected checkout. Worktrees receive test configuration only when required.

## Autonomous Boundary

Agents may read code, edit assigned files, run local checks, commit to their worker branch, and prepare a handoff without user input. They stop before production changes, destructive operations, credential changes, paid-service changes, merges to `main`, or material scope changes.

## Efficient Use

Use at most two implementation workers. Prefer one implementer plus one reviewer for work that touches shared files. Parallelize only independent slices; more agents multiply context and test costs without shortening dependency-bound work.
