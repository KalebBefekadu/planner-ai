---
status: accepted
---

# Use single-owner workspaces for the first release

Planner AI will support multiple registered users, but each first-release Workspace is private and has exactly one owner. Shared Notes, shared Goals, teams, organizations, public pages, and real-time collaboration are deferred until their permission, privacy, and conflict models are designed explicitly.

## Consequences

- Every domain record has one stable owner and is protected by Supabase row-level security.
- Agent context, Operations, automations, and MCP tokens are scoped to that owner.
- Export does not imply sharing; exporting or sending data outside Planner AI is consequential.
- Ownership fields remain stable so a later sharing model can reference records without weakening first-release isolation.
