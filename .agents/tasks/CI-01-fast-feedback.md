# CI-01: Fast pull request feedback

## Goal

Keep pull-request validation useful while reducing avoidable wait time and false failures.

## Scope

- Run a focused browser smoke suite on pull requests.
- Keep the complete browser suite on pushes to `main`.
- Remove the unavailable GitHub dependency-review gate; retain the existing `npm audit` gate.

## Acceptance

- Pull requests exercise auth boundaries, keyboard navigation, security headers, and the Today, Notes, and Planner journeys.
- Merged code still receives the full Playwright suite.
- CI no longer fails solely because GitHub Advanced Security is unavailable.
