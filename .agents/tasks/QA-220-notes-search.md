# QA-220: Reliable nested-Note search

Owner: Codex lead, implementing in an isolated worktree.
Branch: `codex/qa-220-notes-search`
Base: `origin/integration/dogfood` at `d155f47`
Status: fixture repair verified and ready for integration review; original search issue unconfirmed

Scope: diagnose issue #220, prove its timing mechanism, and repair the smallest responsible boundary. Preserve search results, ancestor labels, and pending mutations.

Writable paths: `web/tests/e2e/journey-notes.spec.ts`, `web/tests/e2e/support/workspace.ts`, `web/src/components/notes-workspace.tsx`, `web/src/app/(app)/notes/**`, this contract, `.agents/ACTIVE.md`, and `.agents/reports/QA-220-notes-search.md`. All other paths forbidden. No Preview, migrations, production changes, or shared-stack resets.

Acceptance: reproduce before fixing; at least 20 focused production-build runs across desktop and mobile; affected Notes journeys; `cd web && npm run agent:check`. Commit a focused change and record behavior, files, checks, risks, and SHA in the handoff.

## Evidence and bounded scope adjustment

The baseline ran 60 times: 59 completed the nested-Note search and one failed before Notes, waiting for onboarding. Its trace recorded `POST /login` returning `x-action-redirect: /;push` for the expected new account. `postLoginPath` intentionally permits that destination when the workspace lookup fails or has no row; the trace cannot distinguish those two causes. The fixture incorrectly assumed onboarding was guaranteed.

The bounded repair requests `/onboarding` explicitly only for the two fresh-workspace fixtures, through the existing login return destination. Default sign-in callers remain unchanged. This removes the observed setup ambiguity; it does not establish or close the reported search defect. No product files changed.
