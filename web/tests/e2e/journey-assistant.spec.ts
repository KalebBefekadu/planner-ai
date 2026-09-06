import { test, expect, goTo } from './support/workspace';

test('an AI outage preserves the request and allows a safe retry', async ({ workspace }) => {
  const { page } = workspace;
  let attempts = 0;

  await page.route('**/api/assistant', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { conversations: [] } });
      return;
    }

    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        json: { error: 'The AI provider is temporarily unavailable. Your request is still here.' },
      });
      return;
    }

    await route.fulfill({
      json: {
        reply: 'Your request recovered without changing any planning data.',
        proposal: null,
        evidence: [],
        claims: [],
      },
    });
  });

  await goTo(page, '/');
  await page.getByRole('button', { name: 'Ask Planner AI' }).click();
  const composer = page.getByRole('textbox', { name: 'Message Planner AI' });
  await composer.fill('Turn my notes into a calm weekly plan.');
  await page.getByRole('button', { name: 'Send message' }).click();

  await expect(page.locator('.assistant-error[role="alert"]')).toContainText(
    'The AI provider is temporarily unavailable. Your request is still here.'
  );
  await expect(
    page.getByText('Turn my notes into a calm weekly plan.', { exact: true })
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Retry' }).click();

  await expect(
    page.getByText('Your request recovered without changing any planning data.', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Turn my notes into a calm weekly plan.', { exact: true })
  ).toHaveCount(1);
  expect(attempts).toBe(2);
});
