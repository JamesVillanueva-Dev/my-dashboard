import { test, expect } from './fixtures/test';
import { seed, stored } from './fixtures/seed';
import { FIT_LAYOUT, gridReady, metrics } from './fixtures/grid';
import { centre, frame, panel } from './fixtures/panel';

/**
 * Drag-to-resize, against real layout.
 *
 * The keyboard path is covered by `Dashboard/index.test.tsx`; the pointer path
 * is not covered anywhere, because it needs two things jsdom does not have — a
 * pointer, and a grid whose column tracks have a width. `applySpan` in
 * particular is only ever unit tested against a hand-set `offsetHeight`, so the
 * row arithmetic has never met a card that measured itself.
 */

/** Stored sizes, as `useWidgetLayout` persists them. */
type Sizes = Record<string, { cols: number; height: number | null }>;

test.beforeEach(async ({ page }) => {
  await seed(page, FIT_LAYOUT);
  await page.goto('/');
  await gridReady(page, 3);
});

test('a corner drag widens the panel by a column, and it renders wider', async ({ page }) => {
  const notes = panel(page, 'notes');
  expect(await notes.cols()).toBe(1);

  const before = await notes.box();
  const { colWidth, colGap } = await metrics(page);
  const handle = centre(await notes.handle.boundingBox().then(must));

  // One whole column's worth of travel. Width snaps, so anything within half a
  // step of this lands on the same answer — the assertion is the snap, not the
  // pixel.
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + colWidth + colGap, handle.y, { steps: 10 });
  await frame(page);
  await page.mouse.up();

  await expect.poll(() => notes.cols()).toBe(2);

  // The custom property is only half the claim: the panel has to actually
  // occupy the extra column, which is the part `applySize` can get wrong
  // without any unit test noticing.
  const after = await notes.box();
  expect(after.width).toBeGreaterThan(before.width + colWidth * 0.8);

  await page.reload();
  await gridReady(page, 3);
  expect(await panel(page, 'notes').cols()).toBe(2);
});

test('a sideways drag leaves the height fitting the content', async ({ page }) => {
  // `PIN_THRESHOLD` — without it, widening a panel would freeze it at whatever
  // height its content happened to need, which is not what that gesture asked
  // for.
  const notes = panel(page, 'notes');
  const { colWidth, colGap } = await metrics(page);
  const handle = centre(await notes.handle.boundingBox().then(must));

  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  // Two pixels of vertical slop, as a real hand produces. Under the 5px pin
  // threshold, so it must not count as a height gesture.
  await page.mouse.move(handle.x + colWidth + colGap, handle.y + 2, { steps: 10 });
  await frame(page);
  await page.mouse.up();

  await expect.poll(() => notes.cols()).toBe(2);
  const sizes = await stored<Sizes>(page, 'widget.sizes');
  expect(sizes?.notes.height).toBeNull();
  // Still growing with its content rather than pinned to a number. Note the
  // card's height is *not* expected to be unchanged: it is a column wider now,
  // so the content reflowed and needs a different amount of room — which is
  // exactly what "fits the content" means and what a pinned height would have
  // prevented.
  expect(await notes.item.evaluate((el) => el.style.getPropertyValue('--h'))).toBe('');
  const fits = await notes.card.evaluate(
    (el) => el.scrollHeight <= el.clientHeight + 1,
  );
  expect(fits).toBe(true);
});

test('a downward drag pins the height, and the row span still covers the card', async ({
  page,
}) => {
  const notes = panel(page, 'notes');
  const before = (await notes.cardBox()).height;
  const handle = centre(await notes.handle.boundingBox().then(must));

  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x, handle.y + 140, { steps: 12 });
  await frame(page);
  await page.mouse.up();

  await expect.poll(async () => (await stored<Sizes>(page, 'widget.sizes'))?.notes.height).toBe(
    Math.round(before + 140),
  );
  expect((await notes.cardBox()).height).toBeCloseTo(before + 140, 0);

  // The arithmetic in `applySpan`, checked against a card that measured itself
  // rather than against a stubbed `offsetHeight`: the grid area it reserved must
  // cover the card, and must not overshoot it by more than one row.
  const { row, gap } = await metrics(page);
  const span = await notes.rowSpan();
  const reserved = span * (row + gap) - gap;
  const card = (await notes.cardBox()).height;
  expect(reserved).toBeGreaterThanOrEqual(card - 1);
  expect(reserved).toBeLessThan(card + row + gap);
});

test('a panel cannot be dragged wider than the grid', async ({ page }) => {
  // `applySize` caps the span at the columns actually on screen; without it an
  // item spanning more than the grid has creates implicit columns and overflows
  // the page.
  const notes = panel(page, 'notes');
  const { columns } = await metrics(page);
  const handle = centre(await notes.handle.boundingBox().then(must));

  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  // Far past the right-hand edge of the window.
  await page.mouse.move(handle.x + 4000, handle.y, { steps: 15 });
  await frame(page);
  await page.mouse.up();

  await expect.poll(() => notes.cols()).toBe(columns);
  const body = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(body.scroll).toBeLessThanOrEqual(body.client);
});

test('double-clicking the handle gives the height back to the content', async ({ page }) => {
  const notes = panel(page, 'notes');
  const natural = (await notes.cardBox()).height;
  const handle = centre(await notes.handle.boundingBox().then(must));

  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x, handle.y + 160, { steps: 10 });
  await frame(page);
  await page.mouse.up();
  await expect.poll(async () => (await stored<Sizes>(page, 'widget.sizes'))?.notes.height).not.toBeNull();

  await notes.handle.dblclick();

  await expect.poll(async () => (await stored<Sizes>(page, 'widget.sizes'))?.notes.height).toBeNull();
  await expect.poll(async () => (await notes.cardBox()).height).toBeCloseTo(natural, 0);
});

/** Narrows a `boundingBox()` result, which is `null` only for an unrendered node. */
function must<T>(box: T | null): T {
  if (!box) throw new Error('element has no box');
  return box;
}
