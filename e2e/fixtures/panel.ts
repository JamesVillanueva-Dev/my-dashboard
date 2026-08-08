import type { Locator, Page } from '@playwright/test';

/**
 * Reaching a panel in the grid, and the geometry the drag specs are actually
 * about.
 *
 * Everything here addresses the DOM the way a user would — by the accessible
 * name on the grip and the resize handle — except the grid item itself, which
 * carries no text and is found by the `data-id` `Dashboard` already writes.
 */

/** One panel's elements and measurements. */
export interface Panel {
  /** The grid item: the wrapper `Dashboard` positions and spans. */
  readonly item: Locator;
  /** The widget card inside it — the element `--h` sizes and `applySpan` measures. */
  readonly card: Locator;
  /** The drag grip in the card header. */
  readonly grip: Locator;
  /** The resize handle in the card's bottom-right corner. */
  readonly handle: Locator;
  /** The grid item's box. Throws rather than returning null, so specs can read it inline. */
  box(): Promise<Box>;
  /** The card's box — differs from the item's once a height is pinned. */
  cardBox(): Promise<Box>;
  /** Columns the item currently spans, read from the `--cols` custom property. */
  cols(): Promise<number>;
  /** Rows the item spans, read from the inline `grid-row-end` `applySpan` writes. */
  rowSpan(): Promise<number>;
  /** The translation the item's transform is applying right now. */
  transform(): Promise<string>;
}

/** A measured box, in viewport coordinates. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The centre of a box. */
export function centre(box: Box): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Addresses one panel in the grid.
 *
 * @param page - The page the dashboard is on.
 * @param id - The widget id, as it appears in the saved layout.
 */
export function panel(page: Page, id: string): Panel {
  const item = page.locator(`main > [data-id="${id}"]`);
  const card = item.locator('> section');

  const boxOf = async (locator: Locator): Promise<Box> => {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`panel "${id}" has no box — is it rendered?`);
    return box;
  };

  return {
    item,
    card,
    grip: item.getByRole('button', { name: /^Reorder / }),
    handle: item.getByRole('button', { name: /^Resize / }),
    box: () => boxOf(item),
    cardBox: () => boxOf(card),
    cols: async () =>
      Number(
        await item.evaluate((el) => getComputedStyle(el).getPropertyValue('--cols').trim() || '1'),
      ),
    rowSpan: async () =>
      Number(
        await item.evaluate((el) => (el.style.gridRowEnd.match(/span (\d+)/) ?? ['', '0'])[1]),
      ),
    transform: () => item.evaluate((el) => getComputedStyle(el).transform),
  };
}

/** The widget ids currently in the grid, in DOM order. */
export async function order(page: Page): Promise<string[]> {
  return page.locator('main > [data-id]').evaluateAll((items) =>
    items.map((item) => (item as HTMLElement).dataset.id ?? ''),
  );
}

/**
 * Starts counting how many times the grid's order actually changes.
 *
 * A `MutationObserver` fires more than once per reorder — React moves nodes one
 * at a time — so what is recorded is the *sequence of distinct orders*, which is
 * the thing ADR 0011's jitter number is about. Installed on the page rather than
 * polled from the test, because a poll cannot see a reorder that is undone
 * between two samples, which is precisely the thrash being measured.
 *
 * @param page - The page the dashboard is on.
 * @returns A reader for the orders seen since this was installed.
 */
export async function watchReorders(page: Page): Promise<{ orders(): Promise<string[]> }> {
  await page.evaluate(() => {
    const grid = document.querySelector('main');
    if (!grid) throw new Error('no grid to watch');
    const read = () =>
      [...grid.children].map((child) => (child as HTMLElement).dataset.id ?? '').join(',');
    const seen: string[] = [read()];
    new MutationObserver(() => {
      const now = read();
      if (now !== seen[seen.length - 1]) seen.push(now);
    }).observe(grid, { childList: true });
    (window as unknown as { __orders: string[] }).__orders = seen;
  });

  return {
    orders: () => page.evaluate(() => (window as unknown as { __orders: string[] }).__orders),
  };
}

/**
 * Records which panels run a Web Animation, by widget id.
 *
 * The FLIP path is unreachable in jsdom — no `Element.animate`, no
 * `DOMMatrixReadOnly` — so `useWidgetLayout`'s reduced-motion branch has never
 * been exercised against a browser that has both. Wrapping `animate` rather than
 * polling `getAnimations()` is what makes it deterministic: a 240ms glide can
 * finish between two samples, but the call cannot be missed.
 *
 * @param page - The page to instrument. Call before `page.goto`.
 * @returns A reader for the ids of panels that animated, in call order.
 */
export async function watchAnimations(page: Page): Promise<{ animated(): Promise<string[]> }> {
  await page.addInitScript(() => {
    const store: string[] = [];
    (window as unknown as { __animated: string[] }).__animated = store;
    const original = Element.prototype.animate;
    Element.prototype.animate = function (
      this: Element,
      ...args: Parameters<typeof original>
    ): Animation {
      store.push((this as HTMLElement).dataset?.id ?? this.tagName.toLowerCase());
      return original.apply(this, args);
    };
  });

  return {
    animated: () => page.evaluate(() => (window as unknown as { __animated: string[] }).__animated),
  };
}

/**
 * Drags from one point to another with real trusted pointer events.
 *
 * The steps matter: `useWidgetLayout` only lifts a card once the pointer has
 * travelled past its threshold, and reads positions once per animation frame, so
 * a single jump from start to finish produces one `pointermove` and no drag at
 * all.
 *
 * @param page - The page the dashboard is on.
 * @param from - Where to press.
 * @param to - Where to release.
 * @param steps - Intermediate moves. More is smoother and slower.
 */
export async function dragMouse(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  // One frame for the rAF-throttled step to read the final position.
  await frame(page);
  await page.mouse.up();
  await frame(page);
}

/** Waits for one animation frame — the granularity the drag reads pointers at. */
export async function frame(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}
