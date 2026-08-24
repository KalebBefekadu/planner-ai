---
status: accepted
---

# Limit production agent authority to product capabilities

The production Planner AI assistant may use authorized product Operations and narrowly granted user-scoped automations, but it may not install arbitrary extensions, execute code, edit or deploy core source, reveal or manage infrastructure secrets, change authentication policy, or alter infrastructure. Code-modifying Agent Native capabilities remain developer tools used in isolated development environments. Any later extension system requires a separate security decision and release gate.

## Consequences

- Product Operations and developer Operations must be separate allowlists.
- Production agent and MCP credentials must not have repository, deployment, shell, service-role, or secret-management access.
- User-created automations run with the user's scoped Planner AI permissions, never platform-owner permissions.
- Production extension installation and arbitrary code execution are disabled for the first release.
- Attempts to cross the boundary must be denied and recorded in the security audit trail.
