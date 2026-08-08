import { test, expect } from './fixtures/test';
import { seed, type DashboardState } from './fixtures/seed';
import { gridReady } from './fixtures/grid';
import { order, panel } from './fixtures/panel';

/**
 * The phone layout, at a real 390×844 viewport.
 *
 * Runs in the `mobile` project (see `playwright.config.ts`); the file name is
 * what selects it. Everything here is decided by a media query, which is the one
 * thing a stubbed `matchMedia` can never actually answer — the unit suite tells
 * `matchMedia` what to say and then checks that it was listened to.
 */

/** Panels seeded wider than a phone can show, to prove the cap is applied. */
const WIDE = {
  layout: ['notes', 'classes', 'reminders'],
  'widget.sizes': {
    notes: { cols: 3, height: null },
    classes: { cols: 2, height: null },
    reminders: { cols: 3, height: null },
  },
  'tasks.mergedTodos': true,
  'notes.text': 'Seeded note',
} satisfies DashboardState;

/** The grid's tracks that have any width — see the `test.fail` below for why. */
async function realColumns(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const grid = document.querySelector('main');
    if (!grid) throw new Error('no grid');
    return getComputedStyle(grid)
      .gridTemplateColumns.split(' ')
      .filter((track) => Number.parseFloat(track) > 0).length;
  });
}

test.beforeEach(async ({ page }) => {
  await seed(page, WIDE);
  await page.goto('/');
  await gridReady(page, 3);
});

test('the grid drops to a single column', async ({ page }) => {
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  expect(await realColumns(page)).toBe(1);
});

test('panels stack in order instead of sitting side by side', async ({ page }) => {
  expect(await order(page)).toEqual(['notes', 'classes', 'reminders']);

  const boxes = await Promise.all(
    ['notes', 'classes', 'reminders'].map((id) => panel(page, id).box()),
  );
  for (let i = 1; i < boxes.length; i += 1) {
    expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y);
    expect(boxes[i].x).toBeCloseTo(boxes[0].x, 0);
  }
});

test('nothing overflows sideways', async ({ page }) => {
  const doc = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(doc.scroll).toBeLessThanOrEqual(doc.client);
});

test('a narrow window is still a desktop, by the query ADR 0008 chose', async ({ page }) => {
  // The ADR's actual claim, which only a real browser can answer: form factor is
  // `pointer: coarse`, *not* a width breakpoint, so narrowing a desktop window
  // must not flip you into the phone's layout and start saving over it. This
  // viewport is phone-sized and this pointer is a mouse.
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  expect(coarse).toBe(false);

  // Meanwhile the grid *has* collapsed. The point is that the two decisions are
  // independent: only the visual one follows the width.
  expect(await realColumns(page)).toBe(1);
});

test('every panel fills the single column', async ({ page }) => {
  // KNOWN DEFECT — this documents a bug rather than a behaviour, which is why it
  // is marked failing rather than deleted. When it starts passing, Playwright
  // reports *that* as the failure and this annotation should come off.
  //
  // `Dashboard/styles.module.css` states the invariant plainly: below 640px "the
  // grid drops to a single column and Dashboard caps every span at 1 to match".
  // The cap does not happen. `gridMetrics` counts tracks by splitting the
  // computed `grid-template-columns`, and Chrome includes **implicit** tracks in
  // that value — so three panels each spanning 3 make the grid report
  // `350px 0px 0px`, i.e. three columns, and `applySize` caps their spans at
  // three rather than at one. The measurement is downstream of the thing it is
  // measuring.
  //
  // Visible effect: the two phantom 0px tracks still cost their column gaps, so
  // a panel stored at 2 columns renders 10px narrower than one stored at 3, and
  // the real track loses 20px of the width it should have had.
  test.fail();

  const widths = await Promise.all(
    ['notes', 'classes', 'reminders'].map(async (id) => (await panel(page, id).box()).width),
  );
  expect(widths[1]).toBeCloseTo(widths[0], 0);
  expect(widths[2]).toBeCloseTo(widths[0], 0);
});
