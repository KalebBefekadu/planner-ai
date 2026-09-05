import { defineConfig, devices } from '@playwright/test';

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
    command: `NEXT_DIST_DIR=.next-e2e NEXT_PUBLIC_APP_URL=${publicOrigin} npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `${origin}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
