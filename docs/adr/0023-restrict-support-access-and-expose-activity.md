---
status: accepted
---

# Restrict support access and expose Activity

Planner AI operators have no standing access to Workspace content and cannot impersonate users. Support uses content-free diagnostics first. Content-bearing diagnostic sharing must be initiated and previewed by the user, limited by purpose and time, auditable, revocable, and excluded from analytics or model training.

Users receive an Activity trail for every durable write and sensitive or consequential read. It identifies actor, surface, Operation, target, time, approval, and outcome while omitting or redacting content-bearing inputs by default.

## Consequences

- Support tools need separate operator authorization and cannot use application service-role access as a browsing mechanism.
- Activity is exportable and retained until account deletion; lower-level operational telemetry expires under its shorter retention policy.
- Diagnostic access and support actions appear in the same Activity trail visible to the user.
