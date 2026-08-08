import { test, expect } from './fixtures/test';
import { seed, type DashboardState } from './fixtures/seed';
import { gridReady } from './fixtures/grid';

/**
 * The full-screen panel.
 *
 * `WidgetModal/index.test.tsx` asserts that `document.body.style.overflow` is
 * set to `hidden`. That is the mechanism, not the effect — in jsdom there is no
 * scrollbar for it to lock and nothing would notice if the rule stopped
 * propagating to the viewport. Here the page is genuinely taller than the window
 * and the wheel is genuinely turned.
 */

/** Enough tall panels to push the page well past the 800px viewport. */
const TALL = {
  layout: ['notes', 'classes', 'reminders'],
  'widget.sizes': {
    notes: { cols: 3, height: 700 },
    classes: { cols: 3, height: 700 },
    reminders: { cols: 3, height: 700 },
  },
  'tasks.mergedTodos': true,
  'notes.text': 'Seeded note',
} satisfies DashboardState;

/** Where the window is scrolled to. */
const scrollY = (page: import('@playwright/test').Page) => page.evaluate(() => window.scrollY);

test.beforeEach(async ({ page }) => {
  await seed(page, TALL);
  await page.goto('/');
  await gridReady(page, 3);
});

test('the page behind the dialog genuinely cannot scroll', async ({ page }) => {
  // The premise: without the dialog, the wheel moves the page. If this stops
  // being true the lock assertion below would pass for the wrong reason.
  await page.mouse.wheel(0, 400);
  await expect.poll(() => scrollY(page)).toBeGreaterThan(0);
  await page.mouse.move(640, 400);
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.getByRole('button', { name: 'Show Notes full screen' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await page.mouse.wheel(0, 600);
  // Nothing to poll for — the assertion is that nothing happens — so give the
  // scroll a frame to have happened in and then read it.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  expect(await scrollY(page)).toBe(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // And the page gets its scrolling back, rather than being left locked.
  await page.mouse.wheel(0, 400);
  await expect.poll(() => scrollY(page)).toBeGreaterThan(0);
});

test('the dialog is a portal on the body, not a child of the transformed card', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Show Notes full screen' }).click();

  // Why it is a portal at all: a dragged card carries a transform, and a
  // transformed ancestor captures `position: fixed`, so a dialog rendered inside
  // the card would be clipped to it.
  const parentIsBody = await page
    .getByRole('dialog')
    .evaluate((el) => el.parentElement?.parentElement === document.body);
  expect(parentIsBody).toBe(true);
  expect(await page.locator('main [role="dialog"]').count()).toBe(0);
});

test('Tab stays inside the dialog, and Escape gives focus back to the opener', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Show Notes full screen' });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Far more presses than the dialog has stops, so the cycle has to wrap several
  // times. A trap that only holds for one lap is not a trap.
  for (let press = 0; press < 25; press += 1) {
    await page.keyboard.press('Tab');
    const inside = await dialog.evaluate((el) => el.contains(document.activeElement));
    expect(inside, `focus escaped the dialog after ${press + 1} tabs`).toBe(true);
  }

  // And backwards, which is the direction the wrap is easiest to get wrong.
  for (let press = 0; press < 6; press += 1) {
    await page.keyboard.press('Shift+Tab');
    const inside = await dialog.evaluate((el) => el.contains(document.activeElement));
    expect(inside, `focus escaped the dialog after ${press + 1} back-tabs`).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('the card keeps its slot in the grid while the dialog has its body', async ({ page }) => {
  const notes = page.locator('main > [data-id="notes"]');
  const before = await notes.boundingBox();

  await page.getByRole('button', { name: 'Show Notes full screen' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // The body moves rather than being drawn twice, so the card says where it went
  // — and holds its place, so the layout behind the dialog does not reflow.
  await expect(page.locator('main').getByText('Showing full screen.')).toBeVisible();
  const during = await notes.boundingBox();
  expect(during?.x).toBeCloseTo(before?.x ?? 0, 0);
  expect(during?.y).toBeCloseTo(before?.y ?? 0, 0);
  expect(during?.width).toBeCloseTo(before?.width ?? 0, 0);
});
