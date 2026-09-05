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
    command: `NEXT_DIST_DIR=.next-e2e PLANNER_DATA_MODEL=canonical PLANNER_UI_PREVIEW=enabled PLANNER_UI_V2=enabled NEXT_PUBLIC_APP_URL=${publicOrigin} npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `${origin}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
