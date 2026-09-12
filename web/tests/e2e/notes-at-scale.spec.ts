import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test, expect, goTo } from './support/workspace';
import { currentTotp } from './support/totp';

/* PostgREST caps every response at max_rows (1000, in supabase/config.toml).
 * The cap is a sensible safety net, but it is silent: a query that asks for a
 * whole workspace gets the first thousand rows and no indication that more
 * exist. A 1400-Note workspace was showing 1000 in the tree and exporting a
 * vault of 1000 Markdown files -- quietly short by 400 pages, with no error
 * and no count.
 *
 * A real Notion export is the reason this matters: it is normal for one to
 * arrive with more than a thousand pages, and the vault is the owner's way
 * back out of the product. */

const TOTAL = 1400;

/**
 * Names in a ZIP's central directory, without unpacking it.
 *
 * The end-of-central-directory record is at the tail, and each central
 * directory header begins with the same signature and states its own name
 * length, so the entries can be walked without decompressing anything.
 */
function countZipEntries(archive: Buffer, suffix: string) {
  const END_SIGNATURE = 0x06054b50;
  const HEADER_SIGNATURE = 0x02014b50;
  let end = archive.length - 22;
  while (end >= 0 && archive.readUInt32LE(end) !== END_SIGNATURE) end -= 1;
  if (end < 0) throw new Error('the download is not a ZIP archive');

  const total = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  let matches = 0;
  for (let index = 0; index < total; index += 1) {
    if (archive.readUInt32LE(offset) !== HEADER_SIGNATURE) {
      throw new Error('the central directory is not where the archive says it is');
    }
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name.endsWith(suffix)) matches += 1;
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return matches;
}

/* The database URL is asked for rather than written down: CI starts its own
   Supabase stack on its own ports, and a hard-coded loopback address is one
   machine's configuration rather than a fact. `supabase status` is the same
   source the CI workflow reads its other credentials from. */
let databaseUrl: string | null = null;
function localDatabaseUrl() {
  if (databaseUrl) return databaseUrl;
  const status = JSON.parse(
    execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' })
  ) as { DB_URL?: string };
  if (!status.DB_URL) throw new Error('supabase status did not report a DB_URL');
  databaseUrl = status.DB_URL;
  return databaseUrl;
}

/* SQL goes in on stdin rather than as an argument. Linux caps a single
   argument at 128 KB and a 1400-row insert is well past that, so passing it
   with -c worked on a developer's machine and failed in CI with E2BIG. */
function runSql(sql: string) {
  return execFileSync('psql', [localDatabaseUrl(), '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  });
}

function seedNotes(workspaceId: string, total: number) {
  // The service role is denied direct writes to notes -- everything goes
  // through execute_ui_operation -- so a fixture this size is seeded as
  // postgres rather than by driving the UI 1400 times.
  const values = Array.from(
    { length: total },
    (_, i) =>
      `('${crypto.randomUUID()}','${workspaceId}',null,$q$Imported page ${i}$q$,$q$Body for page ${i}.$q$,'${String(
        i
      ).padStart(6, '0')}')`
  ).join(',');
  runSql(
    `insert into public.notes (id,workspace_id,parent_note_id,title,body_markdown,sort_key) values ${values};`
  );
}

async function workspaceIdFor(
  admin: import('@supabase/supabase-js').SupabaseClient,
  userId: string
) {
  const { data } = await admin
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', userId)
    .limit(1)
    .maybeSingle();
  return (data as { id: string }).id;
}

test('a workspace past the row cap still shows every Note', async ({ workspace }) => {
  test.setTimeout(300_000);
  const { page, admin, userId } = workspace;
  seedNotes(await workspaceIdFor(admin, userId), TOTAL);

  await page.goto('/notes');
  await expect(page.getByRole('navigation', { name: 'Notes' })).toBeVisible({ timeout: 120_000 });

  // Onboarding leaves none of its own Notes behind, so the tree is the seed.
  await expect(page.locator('.note-tree-item')).toHaveCount(TOTAL, { timeout: 120_000 });
});

test('a vault past the row cap still contains every Note', async ({ workspace }) => {
  test.setTimeout(300_000);
  const { page, admin, userId } = workspace;
  seedNotes(await workspaceIdFor(admin, userId), TOTAL);

  await goTo(page, '/settings/security');
  await page.getByRole('button', { name: 'Add authenticator' }).click();
  const secret = await page.locator('#totp-secret').inputValue();
  await page.getByLabel('Verification code').fill(currentTotp(secret));
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByText('Primary authenticator', { exact: true })).toBeVisible();

  await goTo(page, '/settings/data');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Notes' }).click();
  const vault = await download;
  expect(await vault.failure()).toBeNull();

  /* Counted by reading the archive's own central directory rather than by
     shelling out to unzip, so the test does not depend on what a runner image
     happens to have installed -- and deliberately not with the application's
     filesFromZip, which enforces the *import* limits and refuses a vault this
     size outright (see #240). */
  const markdownFiles = countZipEntries(readFileSync((await vault.path())!), '.md');

  // A backup that is quietly short is worse than one that fails loudly.
  expect(markdownFiles, 'the vault was short of the workspace').toBe(TOTAL);
});

test('a plan past the row cap still shows every Goal', async ({ workspace }) => {
  test.setTimeout(300_000);
  const { page, admin, userId } = workspace;
  const workspaceId = await workspaceIdFor(admin, userId);

  /* A hierarchy truncated at max_rows is worse than a truncated list: a Goal
     that is not returned takes its children off the screen with it, so the
     plan looks smaller rather than incomplete. Onboarding leaves one yearly
     Goal behind, so the seed makes up the rest. */
  runSql(`insert into public.goals (workspace_id, vision_id, horizon_id, title)
       select '${workspaceId}', g.vision_id, g.horizon_id, 'Seeded goal ' || i
       from public.goals g
       cross join generate_series(1, ${TOTAL}) as i
       where g.workspace_id = '${workspaceId}'
       limit ${TOTAL};`);

  // Counted as postgres: the service role is denied direct reads here too.
  const count = Number(
    execFileSync('psql', [localDatabaseUrl(), '-tA', '-f', '-'], {
      input: `select count(*) from public.goals where workspace_id = '${workspaceId}' and archived_at is null and trashed_at is null;`,
      encoding: 'utf8',
    }).trim()
  );
  expect(count, 'the seed did not pass the row cap').toBeGreaterThan(1000);

  await goTo(page, '/planner');
  await expect(page.getByRole('heading', { name: 'Plan with a clear line of sight' })).toBeVisible({
    timeout: 120_000,
  });

  // The horizon filter counts the plan it was given, so it reports whatever
  // the page actually received.
  const yearly = page.getByRole('group', { name: 'Filter plan by horizon' }).getByRole('button', {
    name: /^Year/,
  });
  await expect(yearly).toContainText(String(count));
});
