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

test('the assistant remains available after collapsing the desktop sidebar', async ({
  workspace,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile-chromium',
    'The mobile launcher is covered by the outage journey.'
  );
  const { page } = workspace;

  await goTo(page, '/');
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Ask Planner AI' })).toBeVisible();
});

// Approving a Proposal is the one assistant action that changes planning data.
// The dock hides the Proposal card the moment Approve is pressed, so if the
// request never reaches the server the person is left with an error and no way
// back to the change they were about to accept -- they cannot even read what it
// was. A provider outage must cost a retry, not the Proposal.
test('a Proposal survives a failed approval instead of disappearing with the outage', async ({
  workspace,
}) => {
  const { page } = workspace;
  const proposal = {
    id: 'e6f1a0c8-5f2a-4a7d-9f43-6a0d1b2c3d4e',
    summary: 'Add an Action for the invitation draft',
    risk: 'low',
  };
  const approvals: string[] = [];

  await page.route('**/api/assistant', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { conversations: [] } });
      return;
    }
    const body = route.request().postDataJSON() as {
      message?: string;
      approvedProposalId?: string;
    };
    if (body.message) {
      await route.fulfill({
        json: { reply: 'Here is the change I would make.', proposal, evidence: [], claims: [] },
      });
      return;
    }
    if (body.approvedProposalId) {
      approvals.push(body.approvedProposalId);
      if (approvals.length === 1) {
        await route.fulfill({
          status: 503,
          json: {
            error: 'AI assistance is temporarily unavailable. Your source input is unchanged.',
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          reply: 'Applied.',
          proposal: null,
          evidence: [],
          claims: [],
          undoableReceiptId: 'r1',
        },
      });
    }
  });

  await goTo(page, '/');
  await page.getByRole('button', { name: 'Ask Planner AI' }).click();
  await page.getByRole('textbox', { name: 'Message Planner AI' }).fill('Draft the invitation.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(proposal.summary, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.locator('.assistant-error[role="alert"]')).toContainText(
    'temporarily unavailable'
  );
  // A failed write must not be reported as an applied one.
  await expect(page.getByRole('region', { name: 'Undo applied change' })).toHaveCount(0);
  await expect(page.getByText(proposal.summary, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Applied.', { exact: true })).toBeVisible();
  // The retry re-approves the same Proposal rather than creating a second one,
  // so the server sees one idempotent change and not two.
  expect(approvals).toEqual([proposal.id, proposal.id]);
});

// The stage-3 exit gate: AI accelerates the core workflows but is never
// required to finish them. The only honest way to show that is to take every AI
// route away and then do a real day's work by hand -- write a Note, put an
// Action on today, complete it -- with nothing mocked into succeeding.
test('core Notes and Planner work stays completable while every AI route is down', async ({
  workspace,
}) => {
  const { page } = workspace;
  const aiRoutes = [
    '**/api/assistant**',
    '**/api/capture-proposals**',
    '**/api/review-proposals**',
    '**/api/socratic**',
    '**/api/transcribe**',
  ];
  for (const pattern of aiRoutes) {
    await page.route(pattern, (route) => route.abort('connectionfailed'));
  }

  await goTo(page, '/notes');
  const before = page.url();
  await page.getByRole('button', { name: 'New root note' }).click();
  await expect(page).toHaveURL((url) => url.href !== before && /\/notes\?note=/.test(url.href));
  await page.getByRole('textbox', { name: 'Note title' }).fill('Outage plan');
  await page
    .getByRole('textbox', { name: 'Note body, Markdown' })
    .fill('The provider is down and the week still has to be planned.');
  // Autosave is debounced, and the status starts out reading "Saved" from the
  // empty Note. Waiting past the debounce keeps this assertion about the edit
  // that was just typed rather than the state it replaced.
  await page.waitForTimeout(1_000);
  await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 15_000 });

  await goTo(page, '/');
  const composer = page.getByRole('region', { name: 'New Action' });
  await composer.getByRole('textbox', { name: 'What needs doing' }).fill('Book the venue');
  await composer.getByRole('button', { name: 'Add Action' }).click();
  await expect(page.getByRole('button', { name: 'Complete Book the venue' })).toBeVisible();
  await page.getByRole('button', { name: 'Complete Book the venue' }).click();
  await expect(page.getByRole('button', { name: 'Complete Book the venue' })).toHaveCount(0);

  await page.reload();
  await goTo(page, '/notes');
  await expect(
    page
      .getByRole('navigation', { name: 'Notes' })
      .getByRole('button', { name: 'Outage plan', exact: true })
  ).toBeVisible();
});
