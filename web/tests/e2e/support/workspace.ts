import path from 'node:path';

import { test as base, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Playwright hands each fixture a callback that is conventionally named `use`.
// React 19's rules-of-hooks lint cannot tell that apart from the `use` hook, so
// every fixture here names it `provide` instead. The name is positional to
// Playwright; only the linter cares.

// Authenticated journey tests need a real signed-in workspace, which means a
// real Auth user. Creating one is only ever acceptable against the disposable
// local stack, so every helper here refuses to run anywhere else. The guard is
// a value check rather than a flag: a flag can be set by accident, but the
// hosted project URL can never equal the loopback address.
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:55321';
const TEST_PASSWORD = 'Planner-local-journey-test!9';

export function localStackOrSkip(): { url: string; serviceRoleKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url !== LOCAL_SUPABASE_URL || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

export type Workspace = {
  page: Page;
  email: string;
  userId: string;
  admin: SupabaseClient;
};

// The onboarding wizard stands between a new account and every other surface,
// so each journey test would otherwise re-type it. Completing it here keeps the
// journey specs about the journey.
export const onboardingSeed = {
  vision: 'Run a calm, deliberate week without losing the long arc.',
  goal: 'Ship the private beta to ten invited people.',
  action: 'Write the invitation and the first-run guide.',
  capture: 'Remember to ask Dana about the pricing page copy.',
} as const;

export async function completeOnboarding(page: Page) {
  // The dev server compiles each route the first time it is requested, so a
  // cold /onboarding can take well over the default expect timeout. Waiting
  // longer here is not papering over a slow product: production serves this
  // prebuilt. Anything genuinely broken still fails, just later.
  await expect(page.getByRole('heading', { name: 'Set your direction' })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('textbox', { name: 'Vision' }).fill(onboardingSeed.vision);
  await page.getByRole('textbox', { name: 'First yearly Goal' }).fill(onboardingSeed.goal);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('textbox', { name: 'First Action' }).fill(onboardingSeed.action);
  await page.getByRole('textbox', { name: 'First Capture' }).fill(onboardingSeed.capture);
  await page.getByRole('button', { name: 'Enter workspace', exact: true }).click();
  // Finishing onboarding writes a Vision, a Goal, an Action and a Capture in
  // one go. Under parallel workers on the local stack that is comfortably the
  // slowest step in any journey.
  await expect(page).toHaveURL(/\/$/, { timeout: 60_000 });
}

export async function signIn(page: Page, email: string, baseURL?: string) {
  await page.goto(baseURL ? `${baseURL}/login` : '/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Assert the sign-in itself landed before blaming onboarding for a missing
  // heading. A failure here points at authentication; a failure after it points
  // at the wizard.
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 60_000 });
}

async function createLocalUser(admin: SupabaseClient, email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  expect(error).toBeNull();
  return data.user!.id;
}

/**
 * Navigate by URL rather than by clicking the rail. The rail collapses behind a
 * menu button on mobile, and a journey test that fails because a link was
 * hidden is reporting on the viewport, not on the journey.
 */
export async function goTo(page: Page, target: string) {
  await page.goto(target);
  await expect(page).toHaveURL(new RegExp(`${target.replace(/\//g, '\\/')}(?:\\?|$)`));
  await waitForHydration(page);
}

/**
 * Wait until React has taken over the server-rendered markup.
 *
 * Every control in the workspace acts through a click handler, and a click that
 * lands between first paint and hydration is dropped with no trace: the button
 * is visible, enabled, and does nothing. Waiting on the result of that click
 * cannot recover it, so a test that clicks too early fails on timing rather
 * than on the behaviour it was written to check. Retrying the click is not a
 * safe substitute here either, because most of these controls create something.
 *
 * React sets this property on the container when it hydrates the root, which is
 * the moment the handlers become real.
 */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(
    () => Object.keys(document).some((key) => key.startsWith('__reactContainer$')),
    undefined,
    { timeout: 30_000 }
  );
}

/**
 * A workspace created fresh for one test.
 *
 * Use this whenever the test writes data. The isolation costs a sign-up and an
 * onboarding pass, which is why read-only checks should use `scanTest` instead.
 */
export const test = base.extend<{ workspace: Workspace }>({
  workspace: async ({ page }, provide, testInfo) => {
    const local = localStackOrSkip();
    base.skip(
      local === null,
      'Authenticated journeys are restricted to the isolated local Supabase stack.'
    );

    const admin = createClient(local!.url, local!.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // The worker index keeps parallel workers from colliding; the timestamp
    // keeps a re-run from colliding with a leaked user from a killed run.
    const email = `journey-${testInfo.project.name}-w${testInfo.workerIndex}-${Date.now()}@planner-ai.test`;
    const userId = await createLocalUser(admin, email);

    try {
      await signIn(page, email);
      await completeOnboarding(page);
      await provide({ page, email, userId, admin });
    } finally {
      // Deleting the Auth user cascades to the Workspace, so a failed test
      // leaves nothing behind for the next run to trip over.
      await admin.auth.admin.deleteUser(userId);
    }
  },
});

/**
 * A workspace shared by every test in a worker.
 *
 * Creating and onboarding a fresh account per test is the right default when a
 * test writes data, but it does not scale: twenty parallel sign-ups overwhelm
 * the local Auth stack and the failures look like product bugs rather than
 * contention. Read-only checks -- accessibility scans, responsive and zoom
 * passes -- do not need isolation, so they share one signed-in account per
 * worker and reuse its saved storage state.
 */
export const scanTest = base.extend<
  { localStackGuard: void },
  { seededStorageState: string | undefined }
>({
  seededStorageState: [
    async ({ browser }, provide, workerInfo) => {
      const local = localStackOrSkip();
      if (local === null) {
        // A worker fixture cannot skip, so hand back a sentinel and let the
        // per-test guard below skip with a readable reason.
        await provide(undefined);
        return;
      }

      const admin = createClient(local.url, local.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const email = `scan-w${workerInfo.workerIndex}-${Date.now()}@planner-ai.test`;
      const userId = await createLocalUser(admin, email);

      const context = await browser.newContext();
      const page = await context.newPage();
      const statePath = path.join(
        workerInfo.project.outputDir,
        `scan-state-${workerInfo.workerIndex}.json`
      );
      try {
        await signIn(page, email, workerInfo.project.use.baseURL);
        await completeOnboarding(page);
        await context.storageState({ path: statePath });
        await context.close();
        await provide(statePath);
      } finally {
        await context.close().catch(() => {});
        await admin.auth.admin.deleteUser(userId);
      }
    },
    { scope: 'worker' },
  ],

  storageState: async ({ seededStorageState }, provide) => {
    await provide(seededStorageState);
  },

  // A worker fixture cannot skip, and a module-level beforeEach would attach
  // itself to whichever spec file imported this module. An automatic
  // test-scoped fixture is the one place the guard can run per test and still
  // belong to scanTest alone.
  localStackGuard: [
    async ({ seededStorageState }, provide) => {
      base.skip(
        seededStorageState === undefined,
        'Authenticated scans are restricted to the isolated local Supabase stack.'
      );
      await provide();
    },
    { auto: true },
  ],
});

export { expect };
