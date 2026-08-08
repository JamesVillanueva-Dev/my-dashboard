import type { Page } from '@playwright/test';
import type { DashboardState } from './seed';

/**
 * The layout the geometry specs run against.
 *
 * Three panels, all one column wide and all pinned to the same height, so they
 * sit in a single row of identical boxes. That is not a typical dashboard, and
 * it is not meant to be: it makes the arithmetic in a drag assertion a matter of
 * midpoints rather than of which panel happened to render tallest, which is the
 * only way these specs stay readable.
 *
 * None of the three fetches anything, so a drag spec is never racing a panel
 * that is still deciding how tall it is.
 */
export const ROW_LAYOUT: DashboardState = {
  layout: ['notes', 'classes', 'reminders'],
  'widget.sizes': {
    notes: { cols: 1, height: 220 },
    classes: { cols: 1, height: 220 },
    reminders: { cols: 1, height: 220 },
  },
  'notes.text': 'Seeded note',
  reminders: [{ id: 'a', text: 'Seeded task', due: '', done: false }],
  // The retired To-do list never existed here, so skip the one-time merge rather
  // than letting it run and re-render the panel mid-drag.
  'tasks.mergedTodos': true,
  'today.showFocus': false,
};

/** The same three panels, left to grow with their content. */
export const FIT_LAYOUT: DashboardState = {
  ...ROW_LAYOUT,
  'widget.sizes': {
    notes: { cols: 1, height: null },
    classes: { cols: 1, height: null },
    reminders: { cols: 1, height: null },
  },
};

/** What the grid's own computed style says about its tracks. */
export interface Metrics {
  /** Height of one implicit row, in px. */
  row: number;
  /** Vertical gap between rows. */
  gap: number;
  /** Horizontal gap between columns. */
  colGap: number;
  /** Width of a single column track. */
  colWidth: number;
  /** Columns the grid currently has. */
  columns: number;
}

/**
 * Reads the live grid tracks, the same way `lib/gridGeometry.ts` does.
 *
 * Read rather than assumed on purpose: `auto-fill` decides the column count from
 * the available width, so hard-coding it here would make these specs depend on
 * the viewport in a way rule 3 is meant to prevent.
 *
 * The column count is divided out of the grid's width rather than counted from
 * the tracks, because the computed `grid-template-columns` includes the implicit
 * 0px tracks an over-wide panel creates — the mirror of `gridMetrics`, and it has
 * to stay a mirror or a spec here would pass against arithmetic the app does not
 * actually do.
 */
export async function metrics(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const grid = document.querySelector('main');
    if (!grid) throw new Error('no grid');
    const style = getComputedStyle(grid);
    const tracks = style.gridTemplateColumns.split(' ').filter(Boolean);
    const colGap = Number.parseFloat(style.columnGap);
    const colWidth = Number.parseFloat(tracks[0]);
    const width = grid.getBoundingClientRect().width;
    return {
      row: Number.parseFloat(style.gridAutoRows),
      gap: Number.parseFloat(style.rowGap),
      colGap,
      colWidth,
      columns: Math.max(1, Math.round((width + colGap) / (colWidth + colGap))),
    };
  });
}

/**
 * Waits until the grid has settled: every panel present, sized, and spanned.
 *
 * `useWidgetLayout` writes `--cols` and the row span from a layout effect and
 * re-runs it when a `ResizeObserver` reports the content changed. Measuring
 * before that has happened is the single most likely source of flake in these
 * specs, so every one of them starts here.
 *
 * @param page - The page the dashboard is on.
 * @param count - How many panels the seeded layout has.
 */
export async function gridReady(page: Page, count: number): Promise<void> {
  await page.waitForFunction((expected) => {
    const items = document.querySelectorAll<HTMLElement>('main > [data-id]');
    if (items.length !== expected) return false;
    return [...items].every((item) => item.style.gridRowEnd.startsWith('span '));
  }, count);
}
