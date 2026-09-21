import path from 'node:path';

import { test as base, expect, type Locator, type Page } from '@playwright/test';
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

async function seedJourneyPlan(admin: SupabaseClient, userId: string) {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  expect(anonKey).toBeTruthy();
  const owner = await admin.auth.admin.getUserById(userId);
  expect(owner.error).toBeNull();
  const client = createClient(LOCAL_SUPABASE_URL, anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await client.auth.signInWithPassword({
    email: owner.data.user!.email!,
    password: TEST_PASSWORD,
  });
  expect(signedIn.error).toBeNull();
  const workspace = await client
    .from('workspaces')
    .select('timezone,week_starts_on,coaching_intensity,ai_enabled,weekly_review_day')
    .single();
  expect(workspace.error).toBeNull();
  const today = new Date().toISOString().slice(0, 10);
  const seeded = await client.rpc('execute_ui_operation', {
    p_operation_id: 'workspace.onboarding-complete.v1',
    p_input: {
      timezone: workspace.data!.timezone,
      weekStartsOn: workspace.data!.week_starts_on,
      coachingIntensity: workspace.data!.coaching_intensity,
      aiEnabled: workspace.data!.ai_enabled,
      weeklyReviewDay: workspace.data!.weekly_review_day,
      today,
      visionText: onboardingSeed.vision,
      goalTitle: onboardingSeed.goal,
      actionTitle: onboardingSeed.action,
      captureText: onboardingSeed.capture,
    },
    p_idempotency_key: `journey-seed-${userId}`,
  });
  expect(seeded.error).toBeNull();
}

export async function completeOnboarding(page: Page, admin?: SupabaseClient, userId?: string) {
  // The dev server compiles each route the first time it is requested, so a
  // cold /onboarding can take well over the default expect timeout. Waiting
  // longer here is not papering over a slow product: production serves this
  // prebuilt. Anything genuinely broken still fails, just later.
  await expect(
    page.getByRole('heading', { name: 'A one-minute setup, then you’re in.' })
  ).toBeVisible({
    timeout: 60_000,
  });
  await page.getByLabel('What should we call you?').fill('Journey Tester');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Enter Planner AI', exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 60_000 });
  if (admin && userId) await seedJourneyPlan(admin, userId);
}

export async function signIn(page: Page, email: string, baseURL?: string, returnTo?: string) {
  const loginPath = returnTo ? `/login?${new URLSearchParams({ returnTo })}` : '/login';
  await page.goto(baseURL ? `${baseURL}${loginPath}` : loginPath);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Assert the sign-in itself landed before blaming onboarding for a missing
  // heading. A failure here points at authentication; a failure after it points
  // at the wizard.
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 60_000 });
  if (returnTo) {
    await expect(page).toHaveURL(new URL(returnTo, page.url()).href, { timeout: 60_000 });
  }
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
  /* Escape every regex metacharacter, not only the slash. A target carrying a
     query string -- `/goals?view=year` -- used to compile to a pattern where
     the `?` made the previous character optional and `&` meant nothing, so the
     assertion could never match the address it had just navigated to. */
  const pattern = target.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  await expect(page).toHaveURL(new RegExp(`${pattern}(?:[?#]|$)`));
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
 * Replace what a field holds, and prove the replacement took.
 *
 * `fill` is two steps inside the page: select what is there, then insert over
 * the selection. A React render landing between them collapses the selection,
 * and the new text is inserted beside the old rather than over it -- so a field
 * that held "Original line" and was filled with "Their line" ends up holding
 * "Their lineOriginal line", with no separator to make it look like anything
 * but a defect. The editor then autosaves that, and every later assertion is
 * measuring a value nobody typed. It reads as a product bug in whatever the
 * test was actually about, which is the worst possible failure for a test to
 * produce.
 *
 * Filling until the field agrees removes the race rather than waiting it out,
 * and the assertion means a fill that still slips fails where it happened
 * instead of somewhere downstream.
 */
export async function replaceFieldValue(field: Locator, value: string) {
  await expect(field).toBeVisible();
  await expect
    .poll(async () => {
      if ((await field.inputValue()) !== value) await field.fill(value);
      return field.inputValue();
    })
    .toBe(value);
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
      // These fixtures need the wizard, not the default post-login redirect.
      // That redirect deliberately falls back to Today if its workspace lookup
      // fails or returns no row, and a fixture that lands on Today fails inside
      // setup -- which reads as a broken journey rather than a redirect that
      // took its fallback. Request the setup route explicitly so an unrelated
      // journey cannot fail before it starts. Default redirect behavior stays
      // covered by the onboarding journey, which does not pass returnTo.
      await signIn(page, email, undefined, '/onboarding');
      await completeOnboarding(page, admin, userId);
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
        await signIn(page, email, workerInfo.project.use.baseURL, '/onboarding');
        await completeOnboarding(page, admin, userId);
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

/**
 * Open Today's optional fields.
 *
 * A task needs a title and nothing else, so the goal, the life area, the date
 * and the commitment checkbox sit behind a disclosure. A spec that wants one
 * of them has to do what a person does: ask for the details.
 */
export async function openTaskDetails(composer: Locator) {
  const goal = composer.getByRole('combobox', { name: 'Goal' });
  if (await goal.isVisible()) return;
  await composer.locator('summary').filter({ hasText: 'Details' }).click();
  await expect(goal).toBeVisible();
}
