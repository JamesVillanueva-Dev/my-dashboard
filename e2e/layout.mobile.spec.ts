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

/**
 * One-column panels between two full-width ones, to prove the narrow ones pair
 * up instead of each costing a whole screen — the reason the phone grid has two
 * columns at all.
 */
const PAIRED = {
  ...WIDE,
  layout: ['reminders', 'notes', 'weather', 'classes'],
  'widget.sizes': {
    reminders: { cols: 2, height: null },
    notes: { cols: 1, height: null },
    weather: { cols: 1, height: null },
    classes: { cols: 2, height: null },
  },
} satisfies DashboardState;

/**
 * The same panels, but with far more content than a phone screen holds, so the
 * height cap has something to actually bite on. Forty tasks is well past it —
 * uncapped, this one card is several screens tall by itself.
 */
const TALL = {
  ...WIDE,
  reminders: Array.from({ length: 40 }, (_, i) => ({
    id: `t${i}`,
    text: `Seeded task ${i + 1}`,
    due: '',
    done: false,
  })),
} satisfies DashboardState;

/** The grid's tracks that have any width — implicit 0px ones do not count. */
async function realColumns(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const grid = document.querySelector('main');
    if (!grid) throw new Error('no grid');
    return getComputedStyle(grid)
      .gridTemplateColumns.split(' ')
      .filter((track) => Number.parseFloat(track) > 0).length;
  });
}

test.describe('wide panels', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page, WIDE);
    await page.goto('/');
    await gridReady(page, 3);
  });

  test('the grid drops to two columns', async ({ page }) => {
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    expect(await realColumns(page)).toBe(2);
  });

  test('panels stored wider than the phone are capped at two, not stretched past it', async ({
    page,
  }) => {
    // Regression guard for the defect this file used to carry as `test.fail()`.
    // `gridMetrics` counted tracks, Chrome includes the implicit 0px ones a span
    // of 3 creates, so the cap read "three columns" off the very spans it was
    // supposed to be capping and never bit. Dividing the grid's width by its
    // track width instead is immune to that, because implicit tracks are 0px.
    for (const id of ['notes', 'classes', 'reminders']) {
      expect(await panel(page, id).cols()).toBe(2);
    }
  });

  test('every capped panel is exactly the same width', async ({ page }) => {
    // The visible cost of the old defect: the phantom tracks still charged their
    // column gaps, so a panel stored at 2 rendered 10px narrower than one stored
    // at 3 and the real track lost 20px it should have had.
    const widths = await Promise.all(
      ['notes', 'classes', 'reminders'].map(async (id) => (await panel(page, id).box()).width),
    );
    expect(widths[1]).toBeCloseTo(widths[0], 0);
    expect(widths[2]).toBeCloseTo(widths[0], 0);
  });

  test('full-width panels still stack in order', async ({ page }) => {
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
    // The ADR's actual claim, which only a real browser can answer: form factor
    // is `pointer: coarse`, *not* a width breakpoint, so narrowing a desktop
    // window must not flip you into the phone's layout and start saving over it.
    // This viewport is phone-sized and this pointer is a mouse.
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    expect(coarse).toBe(false);

    // Meanwhile the grid *has* collapsed to the phone's two columns. The point is
    // that the two decisions are independent: only the visual one follows width.
    expect(await realColumns(page)).toBe(2);
  });

});

test.describe('a panel with more content than the screen', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page, TALL);
    await page.goto('/');
    await gridReady(page, 3);
  });

  test('is capped at a screenful rather than running the page on', async ({ page }) => {
    // The cap that keeps seven stacked panels from making the page enormous.
    // Seeded with forty tasks precisely so this cannot pass by the panel simply
    // being short — without the cap this card is several screens tall on its own.
    const viewport = page.viewportSize()!.height;
    const { height } = await panel(page, 'reminders').cardBox();

    expect(height).toBeLessThanOrEqual(viewport * 0.72 + 1);
  });

  test('scrolls its own body instead of losing what did not fit', async ({ page }) => {
    // A cap that clipped would be worse than no cap. The body takes the leftover
    // room and scrolls, the same arrangement a pinned height makes.
    const body = panel(page, 'reminders').card.locator('> div');
    const overflow = await body.evaluate((el) => ({
      scrollable: el.scrollHeight > el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
    }));

    expect(overflow).toEqual({ scrollable: true, overflowY: 'auto' });
  });
});

test.describe('one-column panels', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page, PAIRED);
    await page.goto('/');
    await gridReady(page, 4);
  });

  test('two narrow panels share a row instead of stacking', async ({ page }) => {
    const notes = await panel(page, 'notes').box();
    const weather = await panel(page, 'weather').box();

    // Side by side: same row, different columns.
    expect(weather.y).toBeCloseTo(notes.y, 0);
    expect(weather.x).toBeGreaterThan(notes.x + notes.width - 1);
    expect(weather.width).toBeCloseTo(notes.width, 0);
  });

  test('a narrow panel is half the width of a full one', async ({ page }) => {
    const notes = await panel(page, 'notes').box();
    const reminders = await panel(page, 'reminders').box();
    const gap = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.querySelector('main')!).columnGap),
    );

    expect(notes.width * 2 + gap).toBeCloseTo(reminders.width, 0);
  });
});
