import { test, expect } from './fixtures/test';
import { seed } from './fixtures/seed';
import { gridReady } from './fixtures/grid';

/**
 * Themes, checked past the attribute.
 *
 * `useTheme.test.ts` proves the hook writes `data-theme` and points the favicon
 * link somewhere new. What it cannot prove is that any of it had an effect:
 * jsdom applies no stylesheet cascade, so `--bg` resolves to nothing there and a
 * palette could be missing from `src/styles.css` entirely without a single test
 * turning red.
 */

/** Reads a custom property off `:root`, as the cascade resolved it. */
function token(page: import('@playwright/test').Page, name: string): Promise<string> {
  return page.evaluate(
    (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    name,
  );
}

/** Picks a palette from the settings menu, the way a user would. */
async function choose(page: import('@playwright/test').Page, label: RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: label }).check();
  // Close the menu so it never covers a panel a later assertion measures.
  await page.keyboard.press('Escape');
}

test.beforeEach(async ({ page }) => {
  await seed(page, { layout: ['notes'], 'tasks.mergedTodos': true });
  await page.goto('/');
  await gridReady(page, 1);
});

test('picking a palette actually repaints the page', async ({ page }) => {
  // `theme` is seeded as absent, so this starts on `system`, which the browser
  // resolves to light.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const before = { bg: await token(page, '--bg'), accent: await token(page, '--accent') };
  const paintedBefore = await page.evaluate(() => getComputedStyle(document.body).backgroundImage);

  await choose(page, /Forest/);

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'forest');
  // The values `lib/themes.ts` says Forest is, resolved through the stylesheet
  // rather than read back out of the module that declared them. This is what
  // catches a theme whose `:root[data-theme='…']` block was never written.
  await expect.poll(() => token(page, '--bg')).toBe('#0a1310');
  await expect.poll(() => token(page, '--accent')).toBe('#4ade80');
  expect(before.bg).not.toBe('#0a1310');
  expect(before.accent).not.toBe('#4ade80');

  // And the page really re-rendered with them. The body's aura gradients are
  // built from `--bg-grad-1/2`, which the cascade resolves to concrete `rgb()`
  // values — so a changed string here is a style recalc that reached the paint,
  // not merely an attribute flip on `<html>`.
  const painted = await page.evaluate(() => getComputedStyle(document.body).backgroundImage);
  expect(painted).not.toBe(paintedBefore);
  expect(painted).toMatch(/rgb\(\d+, \d+, \d+\)/);
});

test('the favicon is redrawn in the new palette', async ({ page }) => {
  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveAttribute('href', /%23f5f7fb/);

  await choose(page, /Forest/);

  // The icon is an inline SVG data URI built from the theme's two colours, so
  // the accent appears in it percent-encoded.
  await expect(icon).toHaveAttribute('href', /%234ade80/);
  await expect(icon).toHaveAttribute('href', /%230a1310/);
});

test('the chosen palette survives a reload', async ({ page }) => {
  await choose(page, /Ocean/);
  await expect.poll(() => token(page, '--bg')).toBe('#071018');

  await page.reload();
  await gridReady(page, 1);

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ocean');
  await expect.poll(() => token(page, '--bg')).toBe('#071018');
});

test('every palette in the catalogue has a block in the stylesheet', async ({ page }) => {
  // A sweep rather than one theme, because the failure this guards against is
  // adding a theme to `lib/themes.ts` and forgetting the matching
  // `:root[data-theme='…']` rule — which no unit test can see, and which shows
  // up as a page that keeps the previous palette.
  const themes: [string, string][] = [
    ['light', '#f5f7fb'],
    ['rose', '#fdf6f7'],
    ['solarized', '#fdf6e3'],
    ['lavender', '#f7f5fc'],
    ['dark', '#0c0c0d'],
    ['midnight', '#0d0b16'],
    ['forest', '#0a1310'],
    ['ocean', '#071018'],
  ];

  for (const [id, bg] of themes) {
    await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), id);
    expect(await token(page, '--bg'), `theme "${id}" has no palette block`).toBe(bg);
  }
});
