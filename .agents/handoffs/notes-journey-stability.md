# Notes Journey Stability Handoff

## Outcome

Both retry-dependent Notes journeys are now verified deterministic on the current integration branch. No additional product or test timing change was justified.

## Evidence

- Immediate navigation during autosave: 10/10 Chromium runs passed with one worker and retries disabled. Each run created two Notes, typed inside the debounce window, navigated away, reopened the Note, and reloaded it from the server.
- Favorite persistence: 10/10 mobile Chromium runs passed with one worker and retries disabled.
- Favorite contention stress: 8/8 mobile Chromium runs passed with four concurrent signup/onboarding workers and retries disabled.
- The earlier favorite failure occurred in fixture setup before the Notes journey began and did not reproduce under the same contention condition.

## Files changed

- Updated `.agents/ACTIVE.md` to close the stale flake record with measured evidence.
- Added the task contract and this handoff.
- No product, test, timeout, retry, worker-count, schema, or configuration code changed.

## Checks run

- `npx vitest run`: 94 files, 1,068 tests passed.
- `npm run agent:check`: formatting, ESLint, and TypeScript passed.
- Targeted Playwright runs above: 28/28 passed with retries disabled.

## Known risks or blockers

- Production builds logged two benign `destination stream closed early` messages during the autosave stress loop when navigation cancelled an obsolete response; all persistence assertions still passed.
- The Supabase changelog Markdown endpoint could not be rendered by the browsing tool. No Supabase API or database change was made.
