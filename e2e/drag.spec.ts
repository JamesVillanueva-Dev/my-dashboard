import { test, expect } from './fixtures/test';
import { seed } from './fixtures/seed';
import { ROW_LAYOUT, gridReady } from './fixtures/grid';
import { centre, dragMouse, frame, order, panel, watchReorders } from './fixtures/panel';

/**
 * Drag-to-reorder, against real layout.
 *
 * This is the reason the suite exists. `lib/dragOrder.ts` is thoroughly unit
 * tested, but only ever against a hand-written `PanelRect[]` — in jsdom every
 * rect is 0×0, so the model has never once been asked a question by the grid it
 * was written for. Everything below measures the real boxes and moves a real
 * pointer through them.
 */

test.beforeEach(async ({ page }) => {
  await seed(page, ROW_LAYOUT);
  await page.goto('/');
  await gridReady(page, 3);
});

test('the three seeded panels really do sit in one row', async ({ page }) => {
  // A precondition, not a behaviour: every assertion below is about horizontal
  // midpoints, which means nothing if the grid wrapped them into a column.
  const boxes = await Promise.all(
    ['notes', 'classes', 'reminders'].map((id) => panel(page, id).box()),
  );
  expect(boxes[0].y).toBeCloseTo(boxes[1].y, 0);
  expect(boxes[1].y).toBeCloseTo(boxes[2].y, 0);
  expect(boxes[0].x).toBeLessThan(boxes[1].x);
  expect(boxes[1].x).toBeLessThan(boxes[2].x);
});

test('a deliberate drag reorders the grid, and the new order survives a reload', async ({
  page,
}) => {
  expect(await order(page)).toEqual(['notes', 'classes', 'reminders']);

  const notes = panel(page, 'notes');
  const classes = panel(page, 'classes');
  const grip = centre(await notes.grip.boundingBox().then(must));
  const target = await classes.box();

  // Past the middle of the second panel: far enough to be a decision rather than
  // a wobble, which is the distinction `FLIP_HYSTERESIS` exists to draw.
  await dragMouse(page, grip, { x: target.x + target.width * 0.8, y: grip.y });

  await expect
    .poll(() => order(page))
    .toEqual(['classes', 'notes', 'reminders']);

  // The whole point of a reorder is that it is a decision, not a gesture: it has
  // to be in `localStorage` and still there after a navigation.
  await page.reload();
  await gridReady(page, 3);
  expect(await order(page)).toEqual(['classes', 'notes', 'reminders']);
});

test('twenty jitters across a boundary produce one reorder, not twenty', async ({ page }) => {
  const notes = panel(page, 'notes');
  const classes = panel(page, 'classes');
  const grip = centre(await notes.grip.boundingBox().then(must));
  const target = await classes.box();
  const boundary = target.x + target.width / 2;

  const reorders = await watchReorders(page);

  // Lift the card and settle it on the *near* side of the boundary first, so the
  // model has committed to an answer. Until it has, there is nothing for
  // hysteresis to damp — the first resolution of a drag is always taken at face
  // value.
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(boundary - 40, grip.y, { steps: 10 });
  await frame(page);
  expect(await order(page)).toEqual(['notes', 'classes', 'reminders']);

  // One decisive crossing. `FLIP_HYSTERESIS_MAX` is 24px, so 40 past the middle
  // is unambiguous.
  await page.mouse.move(boundary + 40, grip.y, { steps: 10 });
  await frame(page);
  await expect.poll(() => order(page)).toEqual(['classes', 'notes', 'reminders']);

  // Now the wobble a hand actually produces, twenty times over the same line.
  for (let i = 0; i < 20; i += 1) {
    await page.mouse.move(boundary + 3, grip.y);
    await page.mouse.move(boundary - 3, grip.y);
  }
  await frame(page);
  await page.mouse.up();
  await frame(page);

  // `watchReorders` records distinct orders, so the count is reorders and not
  // the several DOM mutations React needs to perform one.
  const seen = await reorders.orders();
  expect(seen).toEqual(['notes,classes,reminders', 'classes,notes,reminders']);
});

test('a held pointer reorders nothing', async ({ page }) => {
  const notes = panel(page, 'notes');
  const grip = centre(await notes.grip.boundingBox().then(must));
  const reorders = await watchReorders(page);

  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  // Past the movement threshold, so the card is genuinely lifted — then still.
  await page.mouse.move(grip.x + 10, grip.y, { steps: 5 });
  await frame(page);
  await expect.poll(() => panel(page, 'notes').item.evaluate((el) => getComputedStyle(el).zIndex))
    .toBe('100');

  for (let i = 0; i < 10; i += 1) await frame(page);
  await page.mouse.up();
  await frame(page);

  expect(await reorders.orders()).toEqual(['notes,classes,reminders']);
  expect(await order(page)).toEqual(['notes', 'classes', 'reminders']);
});

test('pointercancel leaves nothing stuck', async ({ page }) => {
  const notes = panel(page, 'notes');
  const grip = centre(await notes.grip.boundingBox().then(must));

  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x + 60, grip.y + 30, { steps: 8 });
  await frame(page);
  expect(await notes.transform()).not.toBe('none');

  // What a system gesture, a lost pointer, or a browser taking the drag away
  // looks like from the page's side. `useWidgetLayout` routes it into the same
  // teardown as `pointerup` precisely so this cannot strand a card mid-air.
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
  });
  await frame(page);

  await expect.poll(() => notes.transform()).toBe('none');
  await expect.poll(() => notes.item.evaluate((el) => getComputedStyle(el).zIndex)).not.toBe('100');

  // And the gesture is genuinely over: moving the pointer again does nothing.
  const before = await order(page);
  await page.mouse.move(grip.x + 400, grip.y, { steps: 10 });
  await frame(page);
  expect(await order(page)).toEqual(before);
  expect(await notes.transform()).toBe('none');
  await page.mouse.up();
});

test('a click on the grip does not lift the card', async ({ page }) => {
  // `DRAG_THRESHOLD` is 4px. Without it, clicking the grip scales and rotates
  // the card for the length of the click, which reads as a glitch.
  const notes = panel(page, 'notes');
  const grip = centre(await notes.grip.boundingBox().then(must));

  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x + 2, grip.y + 1);
  await frame(page);
  expect(await notes.transform()).toBe('none');
  expect(await notes.item.evaluate((el) => getComputedStyle(el).zIndex)).not.toBe('100');

  await page.mouse.up();
  await frame(page);
  expect(await order(page)).toEqual(['notes', 'classes', 'reminders']);
});

/** Narrows a `boundingBox()` result, which is `null` only for an unrendered node. */
function must<T>(box: T | null): T {
  if (!box) throw new Error('element has no box');
  return box;
}
