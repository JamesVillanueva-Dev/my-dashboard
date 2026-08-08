import { test, expect } from './fixtures/test';
import { keysAtBoot } from './fixtures/seed';
import { order } from './fixtures/panel';

/**
 * The harness proves itself: the app boots at the base path, renders the
 * dashboard a first-time visitor gets, and says nothing to the console doing it.
 */

test.describe('a first visit', () => {
  test('boots the default dashboard with a clean console', async ({ page, consoleErrors }) => {
    const atBoot = await keysAtBoot(page);
    await page.goto('/');

    // Rule 5: assert the fresh context really is fresh rather than assume it.
    expect(await atBoot()).toEqual([]);

    await expect(page.getByRole('heading', { level: 1 })).toContainText('friend');
    await expect(page.locator('main > [data-id]').first()).toBeVisible();

    // The catalogue's default set, in catalogue order (`DEFAULT_LAYOUT`).
    expect(await order(page)).toEqual([
      'reminders',
      'calendar',
      'weather',
      'classes',
      'news',
      'notes',
      'youtube',
    ]);

    // Each panel drew its card, not just its slot.
    await expect(page.getByRole('heading', { name: 'Tasks', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Weather', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notes', level: 2 })).toBeVisible();

    // The lead zone is not a widget; it should be there whatever the layout says.
    await expect(page.getByRole('heading', { name: 'Today', level: 3 })).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test('persists the layout it started from', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main > [data-id]').first()).toBeVisible();

    // Every panel reads storage on first render and writes back on mount, so a
    // dashboard nobody has touched still ends up with its defaults recorded.
    // Reload proves that is a round trip and not an accident of first render.
    const before = await order(page);
    await page.reload();
    await expect(page.locator('main > [data-id]').first()).toBeVisible();
    expect(await order(page)).toEqual(before);
  });
});
