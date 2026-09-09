# QA-01 Sweep: integrated release checks on `integration/dogfood`

Ticket: [QA-01 (#136)](https://github.com/KalebBefekadu/planner-ai/issues/136)
Run date: 2026-09-09
Run by: Claude worker, branch `claude/qa-01-sweep`, isolated worktree.

This is a verification-only sweep. No product code was changed. Every claim below
is backed by a job that was actually run on the commit named here; nothing is
carried over from `docs/status.md`.

## Commit under test

| Field | Value |
| --- | --- |
| Branch | `origin/integration/dogfood` |
| Commit | `5cfde2093e34af8942a8ef5da942866fe3e9b526` |
| Subject | Merge pull request #197 from KalebBefekadu/claude/im-02-structure |
| Committed | 2026-09-09 08:42:50 -0400 |

The ticket's stated baseline was `8e6e75c`; per its own "recheck against current
integration" instruction, this sweep re-ran against the tip above instead.

## Environment

| Component | Version |
| --- | --- |
| macOS | 14.6.1 (x86_64) |
| Node | v25.8.1 |
| Next.js | 16.3.4 |
| Playwright | @playwright/test 1.58.2 (chromium headless shell 1208) |
| Vitest | 4.1.11 |
| Supabase CLI | 2.114.0 |
| PostgreSQL | 17.6 (local stack) |
| Supabase API | `http://127.0.0.1:55321` (local, disposable) |

Notes on the environment, because both affect how the results should be read:

- **Node is out of the declared engine range.** `web/package.json` declares
  `"node": ">=24 <25"`; the host runs v25.8.1, and `npm ci` emitted
  `EBADENGINE`. Every suite below still passed, so this did not mask a failure
  in this run, but the sweep was not executed on the supported runtime. See
  "Unresolved risks".
- **The local stack guard did fire correctly.** `tests/e2e/support/workspace.ts`
  skips authenticated specs unless `NEXT_PUBLIC_SUPABASE_URL` is exactly
  `http://127.0.0.1:55321`. It was, so no authenticated coverage was skipped for
  want of configuration. This is worth stating explicitly: a misconfigured run
  would have reported green while proving almost nothing.
- `web/.env.local` was generated fresh from `supabase status -o json` for this
  run and is gitignored. The owner's existing secrets were not read or copied.
- The local database was reset (`supabase db reset`) before the suites ran, so
  the full canonical migration chain applied cleanly from scratch.

## Results by suite

| Suite | Command | Result | Detail |
| --- | --- | --- | --- |
| Static checks | `npm run agent:check` | **PASS** | Prettier, ESLint and `tsc --noEmit` all clean |
| Unit | `npm test` (vitest) | **PASS** | 60 files, 674 tests, 0 failed |
| Database | `supabase test db` (pgTAP) | **PASS** | 58 files, 1085 assertions, 0 failed |
| Migrations | `supabase db reset` | **PASS** | Full chain applied and seeded from empty |
| Production build | `next build` (via Playwright `webServer`) | **PASS** | Built with `PLANNER_DATA_MODEL=canonical`, `PLANNER_UI_V2=enabled`, `PLANNER_UI_PREVIEW=enabled` |
| Browser stage gate | `npx playwright test` | **FAIL (1 defect)** | 262 passed, 2 failed, 20 skipped, 14.1m |
| Dependency scan | `npm run audit` (`--audit-level=high`) | **PASS** | 0 vulnerabilities |

The browser suite ran the full corpus across **both** configured projects,
`chromium` (Desktop Chrome) and `mobile-chromium` (Pixel 7), against a
**production build** served by `next start` — not `next dev`. Total 284 test
runs.

### Gate counts, not percentages

| Gate | Count |
| --- | --- |
| Browser test runs executed | 264 (262 pass / 2 fail) |
| Browser test runs skipped | 20 (all device-profile gating; see below) |
| Unit tests passed | 674 / 674 |
| pgTAP assertions passed | 1085 / 1085 |
| Distinct product defects found | 1 |
| Flaky tests found | 0 |
| Broken tests found | 0 |

## Triaged failures

Two test runs failed. They are the **same defect** observed once per device
profile, not two defects.

| # | Failure | Category | Evidence |
| --- | --- | --- | --- |
| 1 | `authenticated-accessibility.spec.ts:65` › `Data settings has no automated WCAG A/AA violations` — `[chromium]` | **(a) Real product bug** — pre-existing, already fixed in open PR [#198](https://github.com/KalebBefekadu/planner-ai/pull/198) | axe `color-contrast`, `serious`: `.export-scope-note` renders at **3.47:1** (`#858b87` on `#ffffff`, 13.12px, normal weight) against a required 4.5:1. Tags `wcag2aa`, `wcag143`. |
| 2 | `authenticated-accessibility.spec.ts:65` › `Data settings has no automated WCAG A/AA violations` — `[mobile-chromium]` | **(a) Real product bug** — same root cause as #1 | Identical axe violation, identical measured ratio, same target selector. |

**Proof it is a defect and not a flake.** The failing spec was re-run in
isolation with `--workers=2`, away from the contention of the full corpus:

```
npx playwright test tests/e2e/authenticated-accessibility.spec.ts -g "Data settings" --workers=2
→ 2 failed
```

Both projects failed again, reporting the *same* contrast ratio to two decimal
places. A flake does not reproduce a specific measured value on demand. The
spec also settles all finite animations before scanning
(`authenticated-accessibility.spec.ts`, `settle()`), which rules out the
mid-transition blend that previously produced spurious contrast failures.

**Root cause, for the record.** `web/src/app/globals.css` styles
`.export-section .export-scope-note` with `opacity: 0.78` on top of an already
muted foreground. The composite against the white card is `#858b87`. The text is
the caveat explaining that the Notes vault is not a whole-Workspace backup — so
the least legible text on the screen is the sentence warning the owner about the
limits of their own backup. PR #198 addresses this; **it is deliberately not
fixed here**, per the task contract.

**Flaky: 0. Broken: 0.** No test failed while its subject behaved correctly, and
no pgTAP file reported `FAIL` with all assertions passing — the usual
`select plan(N)` drift signature. Plan counts were cross-checked against the
suite result for all 58 files and none had drifted.

## Skipped tests — all accounted for

20 runs skipped. **None** were skipped for missing configuration or an
unavailable stack. Every one is a device-profile gate where the test is
meaningful on only one of the two projects:

| Count | Spec | Skipped on | Stated reason |
| --- | --- | --- | --- |
| 1 | `keyboard-navigation.spec.ts:3` | `chromium` | "This journey verifies the mobile drawer." |
| 1 | `journey-assistant.spec.ts:55` | `mobile-chromium` | "The mobile launcher is covered by the outage journey." |
| 13 | `reflow-and-motion.spec.ts` (reflow at 320px, reduced motion, style-discard) | `mobile-chromium` | "These conditions are set by the test, not by the device profile." |
| 5 | `shell-frame.spec.ts` (command palette ×4, rail notifications ×1) | `mobile-chromium` | "The palette shortcut is a desktop keyboard affordance." / "The rail is the desktop navigation frame." |

These are counted as **skips, not passes**. The reflow and reduced-motion gates
in particular are verified only under the desktop project; see the coverage
boundary noted below.

## Acceptance criteria assessment

- **Required journeys pass against a production build on desktop and mobile,
  with SHA and environment recorded** — *met, with one documented exception.*
  All journey specs (Notes, import round-trip and restore, Capture, Planner,
  Planner calendar, Today, Review, onboarding, assistant/AI-outage, MCP token
  lifecycle, offline capture, auth boundary, security headers, shell frame,
  keyboard navigation) passed on both projects. The single exception is the
  accessibility scan of `/settings/data`.
- **No known access bypass, silent data loss, false save or daily workflow
  blocker remains** — *no counter-evidence found in this run.* The auth-boundary
  spec (22 runs per project) passed, owner isolation and RLS pgTAP passed, the
  Notes vault round-trip and restore journeys passed, and the conflict-reporting
  and MCP scope-boundary database tests passed. The one open defect is a
  contrast failure: it degrades legibility, it is not an access or data-loss
  defect, and it does not block the daily loop.
- **Evidence includes SHA, checks, results and observed limitations** — this
  document.

## Unresolved risks

Listed as risks, not discounted into a pass rate.

1. **The sweep did not run on the supported Node runtime.** The package declares
   `>=24 <25`; this host is v25.8.1 and `npm ci` warned `EBADENGINE`. Everything
   passed, but "passes on Node 25" is not the same statement as "passes on the
   runtime the project pins," and a release candidate should be certified on the
   pinned one.
2. **Reflow at 320 CSS pixels and reduced motion are proven only under the
   desktop project.** The 13 skipped `reflow-and-motion` runs mean those
   conditions are never exercised under the Pixel 7 device profile — no touch
   emulation, no mobile user agent, no device pixel ratio. The spec's reasoning
   (the test sets the conditions itself) is sound, but it leaves a real
   boundary: a mobile-only regression in these behaviours would not be caught.
3. **One WCAG 2.1 AA contrast failure is live on `integration/dogfood` right
   now.** It is fixed in PR #198, which is open and unmerged at this SHA. Until
   that merges, the integration branch does not pass its own accessibility gate.
4. **The local Supabase stack is shared across worktrees.** This run had
   exclusive use of it. A concurrent run would contend on Auth signup and could
   produce failures that are infrastructure saturation rather than product
   defects. Results from a non-exclusive run should not be compared to these.
5. **Scope limits of this sweep.** It did not cover: AI live-provider evaluation
   (`test:ai:live`, which needs real provider keys), production backup and
   restore drills, or manual screen-reader testing. Automated axe scanning is a
   floor, not a substitute for the latter. These remain unverified at this SHA.

## Regression coverage added

**None.** The task contract permits new coverage only for gaps actually
demonstrated. The one defect demonstrated here is already caught by an existing
test — `authenticated-accessibility.spec.ts` failed on it, which is the suite
working as intended — and is already fixed in PR #198. Adding a test would
duplicate existing coverage rather than close a gap. No other gap was
demonstrated, so none is asserted.

## Reproducing this run

```bash
git worktree add .worktrees/qa-01 -b <branch> 5cfde2093e34af8942a8ef5da942866fe3e9b526
cd .worktrees/qa-01/web
npm ci
# generate .env.local from `npx supabase status -o json`; never copy the owner's
npx supabase db reset
npm run agent:check
npm test
npx supabase test db
npx playwright test          # builds and serves production itself
npm run audit
```
