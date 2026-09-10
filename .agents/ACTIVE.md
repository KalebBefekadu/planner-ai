# Active Agent Work

Roadmap stage: Workspace and delivery hardening.

## Ready for integration review

`QA-220-notes-search`: Codex lead, isolated branch `codex/qa-220-notes-search`.
Contract: [QA-220](tasks/QA-220-notes-search.md).
Handoff: [verification and limitations](reports/QA-220-notes-search.md).

The reproduced failure was in fresh-workspace test setup. That bounded repair is verified. The original nested-search defect remains unconfirmed; issue #220 must not be closed from this evidence.

No implementation remains active in this worktree. Integration review is next; workers never merge their own work.

## Boundaries

Other workers retain their worktrees. Use the running local Supabase stack without restarting or resetting it. Generate throwaway test configuration from local CLI status; never read or copy the owner's environment files. Run `npm ci` in each worktree. Production changes still require explicit approval.
