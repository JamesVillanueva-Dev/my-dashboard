import { test, expect } from './fixtures/test';
import { seed } from './fixtures/seed';
import { ROW_LAYOUT, gridReady } from './fixtures/grid';
import { centre, dragMouse, order, panel, watchAnimations } from './fixtures/panel';

/**
 * The FLIP animation on reorder — the one behaviour these specs deliberately
 * turn animation *on* for.
 *
 * `layoutRect`'s transform correction only ever runs against a `FakeMatrix` stub
 * in `gridGeometry.test.ts`, because jsdom has neither `DOMMatrixReadOnly` nor
 * `Element.animate`. So the whole mechanism — measure, cancel, re-animate, and
 * the reduced-motion branch that skips all of it — has never met a real
 * compositor.
 */

/** Grabs one panel's grip and sweeps it past another's midpoint. */
async function reorder(page: import('@playwright/test').Page): Promise<void> {
  const grip = centre(await panel(page, 'notes').grip.boundingBox().then(must));
  const target = await panel(page, 'classes').box();
  await dragMouse(page, grip, { x: target.x + target.width * 0.8, y: grip.y });
  await expect.poll(() => order(page)).toEqual(['classes', 'notes', 'reminders']);
}

test.describe('with animation allowed', () => {
  test.use({ motion: 'no-preference' });

  test('siblings glide, and nothing is left carrying a transform', async ({ page }) => {
    const animations = await watchAnimations(page);
    await seed(page, ROW_LAYOUT);
    await page.goto('/');
    await gridReady(page, 3);

    await reorder(page);

    // The panel that moved out of the way animated. This is the FLIP proper:
    // it is not the card under the cursor, it is the one the layout displaced.
    expect(await animations.animated()).toContain('classes');

    // And every card settles. A composite-FLIP bug shows up here as a panel
    // stranded with a leftover translate once the glide has finished.
    for (const id of ['notes', 'classes', 'reminders']) {
      await expect.poll(() => panel(page, id).transform()).toBe('none');
    }
    expect(await order(page)).toEqual(['classes', 'notes', 'reminders']);
  });
});

test.describe('with reduced motion', () => {
  // The project default, restated here so this reads as the deliberate contrast
  // to the block above rather than as an omission.
  test.use({ motion: 'reduce' });

  test('no sibling glides, and the reorder still lands', async ({ page }) => {
    const animations = await watchAnimations(page);
    await seed(page, ROW_LAYOUT);
    await page.goto('/');
    await gridReady(page, 3);

    await reorder(page);

    const animated = await animations.animated();
    expect(animated).not.toContain('classes');
    expect(animated).not.toContain('reminders');
    // The dragged card's own drop *is* still animated: `finish()` does not
    // consult the media query, only the FLIP effect does. Asserted rather than
    // glossed over, so the asymmetry is a decision on record instead of
    // something a future reader has to rediscover.
    expect(animated).toContain('notes');

    for (const id of ['notes', 'classes', 'reminders']) {
      await expect.poll(() => panel(page, id).transform()).toBe('none');
    }
  });
});

/** Narrows a `boundingBox()` result, which is `null` only for an unrendered node. */
function must<T>(box: T | null): T {
  if (!box) throw new Error('element has no box');
  return box;
}
