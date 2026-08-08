/**
 * Geometry for the dashboard's masonry grid: reading what the CSS grid actually
 * did, and writing back the two custom properties that size a panel.
 *
 * Kept out of the layout hook because none of it is React — every function here
 * takes an element and returns or sets a number, which is also what makes the
 * awkward parts (transform-corrected measurement, row-span arithmetic) testable
 * without rendering a dashboard.
 */

import type { PanelRect } from './dragOrder';

/**
 * Fallback grid row height and gap, in px, for when the computed style is not
 * readable (jsdom reports no value). The live values are read from the grid
 * itself; these only need to be in the right ballpark.
 */
const ROW = 8;
const GAP = 12;

/** What the grid's computed style says about its own tracks. */
export interface GridMetrics {
  /** Height of one implicit row, in px. */
  row: number;
  /** Vertical gap between rows, in px. */
  gap: number;
  /** Horizontal gap between columns, in px. */
  colGap: number;
  /** Width of a single column track, or 0 when the grid cannot be measured. */
  colWidth: number;
  /** Columns the grid currently has; 0 when it cannot be measured. */
  columns: number;
}

/** Reads the grid's live track size and gap, falling back to the constants above. */
export function gridMetrics(grid: HTMLElement | null): GridMetrics {
  const style = grid ? getComputedStyle(grid) : null;
  const tracks = (style?.gridTemplateColumns ?? '').split(' ').filter(Boolean);
  const colGap = Number.parseFloat(style?.columnGap ?? '') || GAP;
  const colWidth = Number.parseFloat(tracks[0] ?? '') || 0;
  const width = grid?.getBoundingClientRect().width ?? 0;
  return {
    row: Number.parseFloat(style?.gridAutoRows ?? '') || ROW,
    gap: Number.parseFloat(style?.rowGap ?? '') || GAP,
    colGap,
    colWidth,
    // Derived from the grid's own width, *not* counted from `tracks` — that is
    // the whole point. A panel spanning more columns than the grid has creates
    // implicit tracks, and the computed `grid-template-columns` includes them,
    // so counting tracks measures the spans the count is supposed to be capping:
    // three panels spanning 3 in a one-column grid report `350px 0px 0px`, and
    // `applySize` then caps them at three rather than at one.
    //
    // Dividing instead is immune to that. Implicit tracks are 0px and are always
    // appended *after* the explicit ones, so they change neither `colWidth` nor
    // the grid's width, and this arithmetic is exactly what `auto-fill` did.
    columns:
      colWidth > 0 && width > 0 ? Math.max(1, Math.round((width + colGap) / (colWidth + colGap))) : 0,
  };
}

/**
 * The translation an element's transform is currently applying.
 *
 * Needed because `getBoundingClientRect()` **includes** transforms — including
 * the ones a running Web Animation is driving. Subtracting this is the only way
 * to ask where the *layout* has put an element while it is still gliding, and
 * getting that wrong is what made the old FLIP compound its error across
 * reorders.
 */
export function translation(el: HTMLElement): { x: number; y: number } {
  if (typeof DOMMatrixReadOnly !== 'function') return { x: 0, y: 0 };
  const value = getComputedStyle(el).transform;
  if (!value || value === 'none') return { x: 0, y: 0 };
  try {
    const matrix = new DOMMatrixReadOnly(value);
    return { x: matrix.m41, y: matrix.m42 };
  } catch {
    // Unparseable transform (jsdom returns odd values); treat it as none.
    return { x: 0, y: 0 };
  }
}

/** Where the grid has put a panel, with any animation transform taken back off. */
export function layoutRect(el: HTMLElement, id: string): PanelRect {
  const rect = el.getBoundingClientRect();
  const offset = translation(el);
  return {
    id,
    x: rect.left - offset.x,
    y: rect.top - offset.y,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Writes a panel's chosen size onto its grid item as custom properties, which
 * the stylesheet turns into a column span and a card height.
 *
 * The width is capped at the columns actually on screen: an item spanning more
 * than the grid has would create implicit columns and overflow the page.
 */
export function applySize(
  item: HTMLElement,
  size: { cols: number; height: number | null },
  columns: number,
) {
  item.style.setProperty('--cols', String(Math.min(size.cols, Math.max(1, columns))));
  if (size.height == null) item.style.removeProperty('--h');
  else item.style.setProperty('--h', `${size.height}px`);
}

/**
 * Gives a panel a row span matching its rendered height. This is what lets a
 * column grid pack as tightly as the old masonry did while still allowing
 * multi-column spans — CSS multi-column could pack but never span, and a plain
 * grid can span but stretches every row to its tallest item.
 */
export function applySpan(item: HTMLElement) {
  const content = item.firstElementChild as HTMLElement | null;
  if (!content) return;
  const { row, gap } = gridMetrics(item.parentElement);
  // offsetHeight, not getBoundingClientRect: a dragged panel carries a scale
  // transform, which would inflate its measured height and its span with it.
  const span = Math.max(1, Math.ceil((content.offsetHeight + gap) / (row + gap)));
  item.style.gridRowEnd = `span ${span}`;
}
