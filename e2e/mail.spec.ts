import { test, expect } from './fixtures/test';
import { seed } from './fixtures/seed';
import { gridReady } from './fixtures/grid';

/**
 * The Mail panel, in a real browser.
 *
 * Everything about ranking, dismissing, and restoring picks is already proven
 * against a mocked `lib/gmail` and `lib/googleAuth` in
 * `MailWidget/index.test.tsx` — re-driving that here would be exactly the
 * per-widget duplication `docs/e2e-plan.md` warns against, at a hundred times
 * the cost.
 *
 * What those unit tests cannot show is the one thing that only exists once
 * mocks are gone: whether the real widget, wired to the real `fetch` layer,
 * ever reaches for Gmail before it is both configured *and* connected. The
 * e2e `webServer` always blanks `VITE_GOOGLE_CLIENT_ID` (`playwright.config.ts`),
 * so the interactive OAuth consent flow itself stays on the manual checklist
 * (`docs/e2e-manual.md`) — a Google-hosted popup is not something this suite
 * can drive.
 */

test('unconfigured, the panel names what is missing and never reaches for Gmail', async ({
  page,
  network,
}) => {
  await seed(page, { layout: ['mail'], 'tasks.mergedTodos': true });
  await page.goto('/');
  await gridReady(page, 1);

  await expect(page.getByRole('heading', { name: 'Mail', level: 2 })).toBeVisible();
  await expect(page.getByText('VITE_GOOGLE_CLIENT_ID')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Gmail' })).toHaveCount(0);

  // The `configured` gate is checked before anything else in the body, so
  // there is nothing here for `fetch` to have reached — this is the claim a
  // mocked unit test cannot make on its own behalf.
  expect(network.counts.google).toBe(0);
});

test('a stale "connected" flag with no client id still shows the missing-config message', async ({
  page,
  network,
}) => {
  // A believable leftover: the app was configured and connected once, then
  // `VITE_GOOGLE_CLIENT_ID` was removed (or this is simply what every e2e run
  // looks like). `configured` is read before `connected`, so the panel must
  // not try to act on a connection it can no longer have credentials for.
  await seed(page, {
    layout: ['mail'],
    'tasks.mergedTodos': true,
    'mail.connected': true,
  });
  await page.goto('/');
  await gridReady(page, 1);

  await expect(page.getByText('VITE_GOOGLE_CLIENT_ID')).toBeVisible();
  expect(network.counts.google).toBe(0);
});
