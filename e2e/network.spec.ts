import { test, expect } from './fixtures/test';
import { seed } from './fixtures/seed';
import { gridReady } from './fixtures/grid';
import { watchFor } from './fixtures/observe';

/**
 * How the network-backed panels behave over time.
 *
 * The unit suite proves each state renders — a skeleton, an error, a list. What
 * it cannot show is the *transitions* between them, because `fetch` is replaced
 * by a resolved promise and every state change lands in the same tick. Here the
 * responses arrive over a real connection, and the cache in `lib/cache.ts` gets
 * to do the thing it exists for: survive a navigation.
 *
 * One representative panel per behaviour, not all of them. Which error string a
 * 403 produces is a component test's job.
 */

test.describe('weather', () => {
  test('goes from pending to loaded', async ({ page }) => {
    // The skeleton is a real state with a real accessible name, not a spinner —
    // but against a stubbed response it can be gone within a frame, so it is
    // watched from document start rather than looked for after the fact.
    const skeleton = await watchFor(page, '[aria-label="Loading weather"]');
    await seed(page, { layout: ['weather'], 'tasks.mergedTodos': true });
    await page.goto('/');

    await expect(page.getByText('64°F')).toBeVisible();
    expect(await skeleton.everSeen(), 'the panel never showed a pending state').toBe(true);
    await expect(page.getByRole('status', { name: 'Loading weather' })).toBeHidden();
  });

  test('offers a retry when there is nothing to show, and the retry works', async ({
    page,
    network,
  }) => {
    network.fail('weather');
    await seed(page, { layout: ['weather'], 'tasks.mergedTodos': true });
    await page.goto('/');

    await expect(page.getByText("Couldn't load weather.")).toBeVisible();
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();

    network.recover('weather');
    await retry.click();

    await expect(page.getByText('64°F')).toBeVisible();
    await expect(page.getByText("Couldn't load weather.")).toBeHidden();
  });

  test('switching units with the network down is a cold slot, so it does error', async ({
    page,
    network,
  }) => {
    // The counterpart to the stale-data rule below, and the boundary between
    // them: the cache is keyed by place *and* unit, so changing the unit is not
    // a refresh of what is on screen — it is a different slot, and an empty one.
    // With nothing cached under the new key there is genuinely nothing to show,
    // which is the one case `error` is for.
    await seed(page, { layout: ['weather'], 'tasks.mergedTodos': true });
    await page.goto('/');
    await expect(page.getByText('64°F')).toBeVisible();

    network.fail('weather');
    // The unit button's accessible name is the unit it shows, not its `title`.
    await page.getByRole('button', { name: '°F' }).click();

    await expect(page.getByText("Couldn't load weather.")).toBeVisible();
  });
});

test.describe('news', () => {
  test('a second visit paints from cache with no loading flash', async ({ page, network }) => {
    await seed(page, { layout: ['news'], 'tasks.mergedTodos': true });
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Stubbed headline one' })).toBeVisible();
    expect(network.counts.news).toBe(1);

    // The mirror image of the weather assertion above, using the same watcher:
    // there the pending state had to have happened, here it must not have.
    const skeleton = await watchFor(page, '[aria-label="Loading headlines"]');

    await page.reload();
    await expect(page.getByRole('link', { name: 'Stubbed headline one' })).toBeVisible();

    expect(
      await skeleton.everSeen(),
      'the news panel blanked to a skeleton before painting cached headlines',
    ).toBe(false);
  });

  test('a failed refresh leaves the headlines up rather than replacing them', async ({
    page,
    network,
  }) => {
    // `useCachedResource`'s rule, and the reason `error` is only ever for an
    // empty panel: a stale headline beats an error message. This is the same
    // cache key throughout — the refresh button — so there is something to keep.
    // Unreachable in jsdom, where nothing survives long enough to go stale.
    await seed(page, { layout: ['news'], 'tasks.mergedTodos': true });
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Stubbed headline one' })).toBeVisible();

    network.fail('news');
    await page.getByRole('button', { name: 'Refresh' }).click();

    await expect(page.getByText("Couldn't load this feed.")).toBeHidden();
    await expect(page.getByRole('link', { name: 'Stubbed headline one' })).toBeVisible();
  });

  test('switching to a feed already read does not go back to the network', async ({
    page,
    network,
  }) => {
    await seed(page, { layout: ['news'], 'tasks.mergedTodos': true });
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Stubbed headline one' })).toBeVisible();

    await page.getByRole('button', { name: 'World' }).click();
    await expect(page.getByRole('link', { name: 'Stubbed headline one' })).toBeVisible();
    const afterSecondFeed = network.counts.news;

    // Back to the first tab: cached, fresh, and therefore silent.
    await page.getByRole('button', { name: 'BBC Top' }).click();
    await expect(page.getByRole('link', { name: 'Stubbed headline one' })).toBeVisible();
    expect(network.counts.news).toBe(afterSecondFeed);
  });
});

test('offline, the dashboard still comes up and every panel fails on its own', async ({
  page,
  network,
  consoleErrors,
}) => {
  network.disconnect();
  await seed(page, { 'tasks.mergedTodos': true });
  await page.goto('/');

  // The whole dashboard, not a blank page or a partial one.
  await gridReady(page, 7);
  await expect(page.getByRole('heading', { name: 'Tasks', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Notes', level: 2 })).toBeVisible();

  // Each network panel reports its own failure, in its own card.
  await expect(page.getByText("Couldn't load weather.")).toBeVisible();
  await expect(page.getByText("Couldn't load this feed.")).toBeVisible();

  // And the panels that need nothing carry on working.
  await page.getByPlaceholder('Add a task…').fill('Offline still works');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Offline still works')).toBeVisible();

  // Failed requests log to the console — that is the browser reporting the
  // network, not the app misbehaving. What must not happen is an exception
  // escaping to the top and taking the page with it.
  //
  // One exclusion, and it is not ours: with the embed unreachable, Chrome swaps
  // its own network-error document into the YouTube iframe, and *that* document
  // throws reaching for `localStorage` from an opaque origin. It is browser
  // chrome in a third-party frame, raised by no line of this app.
  const uncaught = consoleErrors
    .filter((line) => line.startsWith('uncaught:'))
    .filter((line) => !line.includes("Failed to read the 'localStorage' property"));
  expect(uncaught).toEqual([]);

  // Reconnecting is enough; nothing needs a reload.
  network.reconnect();
  await page.getByRole('button', { name: 'Retry' }).first().click();
  await expect(page.getByText('64°F')).toBeVisible();
});
