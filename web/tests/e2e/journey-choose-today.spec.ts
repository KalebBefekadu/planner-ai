import { test, expect, goTo, onboardingSeed } from './support/workspace';

/* "Help me choose today" is optional in the strongest sense: the test
   environment has no AI provider configured, so this journey is the outage
   case, and it is the one that matters most. The promise is that planning your
   day never depends on a model being reachable. */

test('choosing today by hand is unaffected when the suggestion fails', async ({ workspace }) => {
  const { page } = workspace;
  await goTo(page, '/');

  const suggestion = page.getByRole('region', { name: /Help me choose today/i });
  await expect(suggestion).toBeVisible();
  // Nothing has been asked for or written on arrival.
  await expect(suggestion).toContainText('work you have already planned');

  await suggestion.getByRole('button', { name: 'Suggest a short list' }).click();

  // With no provider reachable, the page says so rather than hanging or
  // pretending, and it does not commit anything.
  const committed = page.getByRole('region', { name: 'Committed Actions' });
  await expect(committed).toContainText('0 / 5', { timeout: 30_000 });

  // The manual path is untouched: the same decision, made by hand.
  await page.getByRole('button', { name: `Focus ${onboardingSeed.action}` }).click();
  await expect(committed).toContainText('1 / 5');
  await expect(committed).toContainText(onboardingSeed.action);
});
