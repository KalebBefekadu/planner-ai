---
status: accepted
---

# Use verified authentication and step-up MFA

Planner AI will launch with verified email/password and Google OAuth. A verified email is required before a Workspace can be opened, and identities with the same verified email may be linked through Supabase. TOTP MFA is optional during private beta, but a recent `aal2` session is required for login-identity changes, offline MCP grants, complete data export, and account deletion.

## Consequences

- Custom SMTP, password reset, Google OAuth, identity-linking, and duplicate-account tests are release requirements.
- MFA enrollment must explain recovery and backup-factor behavior without inventing recovery codes.
- Phone, anonymous, magic-link-only, passkey, and additional social sign-in remain deferred.
