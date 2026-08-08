import { test, expect } from './fixtures/test';
import { enableAuthGate } from './fixtures/authGate';
import { storedKeys } from './fixtures/seed';
import { gridReady } from './fixtures/grid';
import { order } from './fixtures/panel';

/**
 * The demo round trip, with the sign-in gate switched on.
 *
 * The demo is not a mock — it is the real `Dashboard` mounted under
 * `DEMO_SCOPE`, and the two claims worth checking are exactly the two that
 * `localStorage` can betray: the sample data must not be able to reach a real
 * account's namespace, and leaving must take all of it with you. See
 * `fixtures/authGate.ts` for what is stubbed to get here, and what that means.
 */

test.beforeEach(async ({ page }) => {
  await enableAuthGate(page);
});

test('a visitor lands, tries the demo, and leaves without a trace', async ({ page }) => {
  await page.goto('/');

  // With a key configured there is a signed-out state to land on.
  await expect(page.getByRole('heading', { name: 'Your whole day, on one page.' })).toBeVisible();
  await expect(page.locator('main > [data-id]')).toHaveCount(0);

  await page.getByRole('button', { name: /Try the live demo/ }).first().click();

  // The real dashboard, furnished with the sample day.
  await expect(page.getByRole('region', { name: 'Demo mode' })).toBeVisible();
  await gridReady(page, 6);
  expect(await order(page)).toEqual([
    'reminders',
    'calendar',
    'weather',
    'news',
    'notes',
    'youtube',
  ]);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Alex');
  // Two matches on purpose: a dated task appears in the Today agenda as well as
  // in the Tasks panel, which is the merge the lead zone exists to do.
  await expect(page.getByText('Send the Q3 deck to Priya')).toHaveCount(2);

  // Everything the *dashboard* wrote is namespaced. This is the claim that
  // matters: the sample data cannot reach a real account, because every key it
  // touches carries the scope prefix.
  const keys = await storedKeys(page);
  expect(keys.filter((key) => key.startsWith('demo:')).length).toBeGreaterThan(0);

  // Stated as an exact set rather than a loose filter, so a key that starts
  // leaking names itself in the failure. Two things legitimately sit outside the
  // scope: `cache:*`, which is public weather and headlines rather than anyone's
  // data, and `theme`, which the landing page owns — a visitor's palette belongs
  // to the browser and is chosen before there is any scope to put it in.
  const unscoped = keys.filter((key) => !key.startsWith('demo:') && !key.startsWith('cache:'));
  expect(unscoped).toEqual(['theme']);

  await page.getByRole('button', { name: /Exit demo/ }).click();

  await expect(page.getByRole('heading', { name: 'Your whole day, on one page.' })).toBeVisible();
  expect(await storedKeys(page)).not.toContainEqual(expect.stringMatching(/^demo:/));
});

test('changes made in the demo survive a reload, and still leave with it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Try the live demo/ }).first().click();
  await gridReady(page, 6);

  await page.getByPlaceholder('Add a task…').fill('Something a visitor typed');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Something a visitor typed')).toBeVisible();

  // Seeding is only-if-absent on purpose: someone who rearranges the demo and
  // reloads should find their arrangement, not a reset.
  await page.reload();
  await page.getByRole('button', { name: /Try the live demo/ }).first().click();
  await gridReady(page, 6);
  await expect(page.getByText('Something a visitor typed')).toBeVisible();

  await page.getByRole('button', { name: /Exit demo/ }).click();
  expect(await storedKeys(page)).not.toContainEqual(expect.stringMatching(/^demo:/));

  // And a second visit starts fresh rather than resurrecting it.
  await page.getByRole('button', { name: /Try the live demo/ }).first().click();
  await gridReady(page, 6);
  await expect(page.getByText('Something a visitor typed')).toBeHidden();
});

test('the sign-in screen is reachable and returns to the landing page', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  // Clerk's own form is stubbed out — what is being checked is the navigation
  // around it, which is this app's code. Signing in is deliberately out of scope.
  await page.getByRole('button', { name: /Back/ }).click();
  await expect(page.getByRole('heading', { name: 'Your whole day, on one page.' })).toBeVisible();
});
