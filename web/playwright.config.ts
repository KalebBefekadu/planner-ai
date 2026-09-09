import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

// The dev server started below reads .env.local itself, but the test process
// does not. Without this the authenticated specs cannot see the Supabase URL,
// so their local-stack guard skips them -- and a suite that skips its only
// authenticated coverage still reports green. Load the file into the runner so
// the guard reflects the stack rather than the absence of configuration.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const origin = `http://127.0.0.1:${port}`;
const publicOrigin = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // Authenticated specs sign up and onboard a fresh account, and they run
  // against `next dev`, which compiles each route on first request. Five
  // seconds is a reasonable default against a built app and far too short
  // here, where a slow assertion means contention rather than a defect.
  expect: { timeout: 15_000 },
  // A journey signs up, onboards, then walks a multi-step flow, each step a
  // round trip through the dev server and the local database. Thirty seconds
  // is the Playwright default for a single interaction, not for a journey.
  timeout: 120_000,
  // The local Supabase Auth stack is intentionally small. Four concurrent
  // signup/onboarding flows still exercise independent workspaces without
  // turning local infrastructure saturation into a false product failure.
  // CI ran one worker while the machine has several cores, which is why the
  // full suite took fifteen minutes there and four minutes locally. Three is
  // below the local four -- the shared Auth stack is small and CI is slower --
  // and the two retries above already absorb the occasional contended signup.
  workers: process.env.CI ? 3 : 4,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? origin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // The corpus runs against a production build, not the dev server.
    //
    // These journeys are the evidence that the shipped application works, and
    // the dev server is not what ships: it recompiles per request, and a
    // cancelled React Server Component stream -- which a person causes just by
    // navigating away mid-render -- was ending the whole dev process. Every
    // test after that point then failed against a server that was simply gone,
    // which reads as a broad regression rather than one cancelled request.
    command: `NEXT_DIST_DIR=.next-e2e PLANNER_DATA_MODEL=canonical PLANNER_UI_PREVIEW=enabled PLANNER_UI_V2=enabled NEXT_PUBLIC_APP_URL=${publicOrigin} npm run build && NEXT_DIST_DIR=.next-e2e PLANNER_DATA_MODEL=canonical PLANNER_UI_PREVIEW=enabled PLANNER_UI_V2=enabled NEXT_PUBLIC_APP_URL=${publicOrigin} npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: `${origin}/login`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
