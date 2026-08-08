import { test, expect } from './fixtures/test';
import { seed } from './fixtures/seed';
import { ROW_LAYOUT, gridReady } from './fixtures/grid';
import { centre, order, panel } from './fixtures/panel';

/**
 * Reordering with a finger.
 *
 * ADR 0011 calls `TOUCH_HOLD_MS` "a guess that has not been tried on real
 * hardware", and Playwright is not real hardware either — but these are genuine
 * trusted touch events dispatched through the DevTools protocol, so the browser
 * synthesises the same `pointerType: 'touch'` events a phone would, and the
 * hold-versus-scroll decision is made by the same code. That is closer than
 * nothing, and much closer than the `MouseEvent` with `pointerType` bolted onto
 * it that `Dashboard/index.test.tsx` has to use.
 */

test.use({ hasTouch: true });

/** The touch phases the protocol accepts. */
type TouchPhase = 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';

/** Drives `Input.dispatchTouchEvent`, which `page.touchscreen` does not expose. */
async function finger(page: import('@playwright/test').Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: TouchPhase, points: { x: number; y: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  return {
    down: (x: number, y: number) => send('touchStart', [{ x, y }]),
    move: (x: number, y: number) => send('touchMove', [{ x, y }]),
    up: () => send('touchEnd', []),
  };
}

/** Whether the card is lifted, read from the z-index `.item.isDragging` sets. */
function lifted(page: import('@playwright/test').Page, id: string): Promise<string> {
  return panel(page, id).item.evaluate((el) => getComputedStyle(el).zIndex);
}

test.beforeEach(async ({ page }) => {
  await seed(page, ROW_LAYOUT);
  await page.goto('/');
  await gridReady(page, 3);
  // The events below only arrive as touch if the context actually has a
  // touchscreen; without this the whole file would silently test the mouse path.
  expect(await page.evaluate(() => 'ontouchstart' in window)).toBe(true);
});

test('a finger that rests on the grip picks the panel up and reorders it', async ({ page }) => {
  const notes = panel(page, 'notes');
  const grip = centre(await notes.grip.boundingBox().then(must));
  const target = await panel(page, 'classes').box();
  const touch = await finger(page);

  await touch.down(grip.x, grip.y);
  // Waiting on the effect rather than on a duration: `TOUCH_HOLD_MS` is the
  // app's timer, and polling for the lift is what rule 1 asks for.
  await expect.poll(() => lifted(page, 'notes')).toBe('100');

  for (let step = 1; step <= 10; step += 1) {
    const x = grip.x + ((target.x + target.width * 0.8 - grip.x) * step) / 10;
    await touch.move(x, grip.y);
  }
  await touch.up();

  await expect.poll(() => order(page)).toEqual(['classes', 'notes', 'reminders']);
  await expect.poll(() => notes.transform()).toBe('none');
});

test('a finger that moves straight away is scrolling, and keeps its gesture', async ({ page }) => {
  // The reason the hold exists. Without it every attempt to scroll the page from
  // a grip becomes a reorder, which on a phone is most attempts.
  const notes = panel(page, 'notes');
  const grip = centre(await notes.grip.boundingBox().then(must));
  const target = await panel(page, 'classes').box();
  const touch = await finger(page);

  await touch.down(grip.x, grip.y);
  // Past `DRAG_THRESHOLD` before the hold can elapse: the gesture is dropped
  // there and then, listeners and all.
  await touch.move(grip.x + 20, grip.y);

  // Everything after this point should be inert, so sweep the full distance a
  // successful drag would have covered and confirm nothing followed.
  for (let step = 1; step <= 10; step += 1) {
    const x = grip.x + 20 + ((target.x + target.width * 0.8 - grip.x) * step) / 10;
    await touch.move(x, grip.y);
  }
  await touch.up();

  expect(await lifted(page, 'notes')).not.toBe('100');
  expect(await notes.transform()).toBe('none');
  expect(await order(page)).toEqual(['notes', 'classes', 'reminders']);
});

/** Narrows a `boundingBox()` result, which is `null` only for an unrendered node. */
function must<T>(box: T | null): T {
  if (!box) throw new Error('element has no box');
  return box;
}
