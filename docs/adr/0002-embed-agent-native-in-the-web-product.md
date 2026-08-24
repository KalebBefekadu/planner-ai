---
status: accepted
---

# Embed Agent Native in the existing web product

Status: Superseded for v1 by ADR-0024.

Planner AI will keep the Next.js `web` application as its only product shell and embed a separately deployed, minimal Agent Native runtime as a docked sidecar. This preserves the click-first workspace and Supabase authentication while adding durable chat, page context, approvals, automations, and MCP without merging Next.js and React Router runtimes or maintaining a second user-facing application.

## Consequences

- The separate `planner` application is an integration lab, not the production sidecar, and will be retired after useful patterns are extracted.
- Planner AI domain records remain in Supabase; Agent Native may own only framework state such as chats, settings, agent resources, and sessions.
- Every product capability must be implemented as a shared Planner AI Operation before its UI or agent experience is considered complete.
- The embedded agent receives server-verified identity and only the page or selection context the signed-in user is authorized to see.
