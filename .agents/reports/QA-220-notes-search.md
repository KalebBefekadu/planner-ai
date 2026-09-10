# QA-220 handoff: explicit onboarding for fresh test workspaces

## Behavior and cause

Fresh authenticated journey and accessibility fixtures now request `/onboarding` through the existing login `returnTo` parameter and verify that destination. They previously assumed the default sign-in destination was always onboarding. The production login helper intentionally falls back to `/` when its workspace lookup fails or returns no row.

A baseline failure reached Today with the correct new account. Its trace recorded `POST /login` returning `x-action-redirect: /;push`; the fixture then waited 60 seconds for the missing onboarding heading. No Notes test steps had executed. The exact reason for the lookup fallback was not captured.

Default `signIn` callers still exercise automatic redirects. No product behavior, migrations, dependencies, or Preview files changed.

## Files

- `web/tests/e2e/support/workspace.ts`: optional explicit destination and two fresh-workspace callers.
- `.agents/ACTIVE.md`, this report, and the task contract: assignment, evidence, and handoff.

## Verification

Node 24.21.0; pinned dependencies installed with `npm ci`; local loopback Supabase; production Next build.

- Unmodified nested-Note journey: 20/20 passed at two workers; then 39/40 passed at four workers. The single failure was the onboarding setup described above.
- After repair: 20/20 nested-Note journeys passed at four workers (10 desktop, 10 mobile), with no retries or skips.
- Six additional browser checks passed: desktop/mobile dark-mode accessibility (shared scan fixture), interrupted onboarding (default sign-in), and stored-version conflict recovery (default sign-in for the second session).
- `npm run agent:check`: formatting, lint, and TypeScript passed.
- `git diff --check`: passed.

A temporary compatibility-runner configuration initially started two web servers and failed before tests ran. It was corrected, all six checks passed, and the temporary configuration was removed.

## Limits

Issue #220's reported search defect was not reproduced in 59 completed baseline search journeys. Do not claim this repair closes that issue or fixes the product login fallback. Future investigation needs a trace that actually reaches and fails search. No broad release suite or production verification was performed. No shared-stack restart/reset or production changes occurred.

Changes are ready for integration review on `codex/qa-220-notes-search`; the final handoff message supplies the commit SHA.
