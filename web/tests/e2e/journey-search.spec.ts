import { test, expect, goTo, waitForHydration } from './support/workspace';

/* The workspace search page.
 *
 * It had no browser coverage at all, which is how a regression reached it: the
 * Notes tree query was narrowed to titles and structure -- correct for a
 * sidebar -- and this page kept ranking and excerpting on a body that was no
 * longer arriving. A query matching only what a Note said returned nothing,
 * silently, because an empty body is not an error.
 *
 * So the assertions here are deliberately about the body rather than the title.
 * A search that finds a page by its title proves almost nothing: the title is
 * on screen either way. */

async function createNote(page: import('@playwright/test').Page, title: string, body: string) {
  const before = page.url();
  await page.getByRole('button', { name: 'New root note' }).click();
  await expect(page).toHaveURL((url) => url.href !== before && /\/notes\?note=/.test(url.href));
  await page.getByRole('textbox', { name: 'Note title' }).fill(title);
  await page.getByRole('textbox', { name: 'Note body, Markdown' }).fill(body);
  await expect(page.getByRole('status')).toHaveText('Saved');
}

test('a page is found by what it says, not only by what it is called', async ({ workspace }) => {
  const { page } = workspace;

  await goTo(page, '/notes');
  await createNote(
    page,
    'Tuesday',
    'The retrieval rewrite has to survive a cold cache before anyone trusts it.'
  );

  // goTo builds a URL matcher from the path, and a query string's ? is a regex
  // quantifier, so an address with one has to be navigated directly.
  await page.goto('/search?q=cold%20cache');
  await waitForHydration(page);

  // Found by a phrase that appears nowhere in its title.
  await expect(page.getByRole('link', { name: /Tuesday/ })).toBeVisible();
  /* And the row itself shows the words that matched, so a result can be judged
     without opening it. Scoped to the link rather than the page, because the
     heading echoes the query too and matching that would pass with an empty
     excerpt -- which is precisely the shape this regression took. */
  await expect(page.getByRole('link', { name: /Tuesday/ })).toContainText(
    'has to survive a cold cache'
  );
});

test('a query that matches nothing says so rather than showing an empty page', async ({
  workspace,
}) => {
  const { page } = workspace;

  await goTo(page, '/notes');
  await createNote(page, 'Tuesday', 'Something entirely unrelated.');

  await page.goto('/search?q=zzzznothingmatches');
  await waitForHydration(page);

  /* An empty result list that looks the same as a workspace with nothing in it
     reads as data loss. */
  await expect(page.getByRole('link', { name: /Tuesday/ })).toHaveCount(0);
  await expect(page.getByText(/no results|nothing|no matches/i).first()).toBeVisible();
});

/* A workspace the size of a real Notion export answers most queries with more
 * rows than fit on a screen, and what the person usually knows is the kind of
 * thing they are after. Onboarding leaves a Vision, a Goal, an Action and a
 * Capture behind, so a query that matches across kinds is available without
 * building anything first. */
test('search narrows by kind without losing the rest of the query', async ({ workspace }) => {
  const { page } = workspace;

  await goTo(page, '/notes');
  await page.getByRole('button', { name: 'New root note' }).click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Untitled');
  await page.getByRole('textbox', { name: 'Note title' }).fill('Invitation copy');
  await page
    .getByRole('textbox', { name: 'Note body, Markdown' })
    .fill('Draft the private beta invitation for the first ten people.');
  await expect(page.getByRole('status')).toHaveText('Saved');

  await goTo(page, '/search');
  await page.getByRole('searchbox', { name: 'Search workspace' }).fill('invitation');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  const filter = page.getByRole('navigation', { name: 'Filter results by kind' });
  await expect(filter).toBeVisible();

  const everything = filter.getByRole('link', { name: /^Everything/ });
  await expect(everything).toHaveAttribute('aria-current', 'page');

  const results = page.getByRole('link', { name: /Invitation copy/ });
  await expect(results.first()).toBeVisible();

  // Narrowing to Pages keeps the query and marks the chosen kind.
  await filter.getByRole('link', { name: /^Pages/ }).click();
  await expect(page).toHaveURL(/\/search\?q=invitation&kind=page/);
  await expect(page.getByRole('searchbox', { name: 'Search workspace' })).toHaveValue('invitation');
  await expect(filter.getByRole('link', { name: /^Pages/ })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(page.getByRole('link', { name: /Invitation copy/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No results' })).toHaveCount(0);

  // A kind the query does not reach reports zero rather than pretending, and
  // offers the way back instead of a dead end.
  await filter.getByRole('link', { name: /^Captures/ }).click();
  await expect(page.getByRole('heading', { name: 'No results' })).toBeVisible();
  await page.getByRole('link', { name: 'Search everything instead' }).click();
  await expect(page).toHaveURL(/\/search\?q=invitation$/);
  await expect(page.getByRole('link', { name: /Invitation copy/ }).first()).toBeVisible();
});
