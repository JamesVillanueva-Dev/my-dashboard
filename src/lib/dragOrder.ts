/**
 * Where a dragged panel should land, given where the pointer is.
 *
 * This is the decision the dashboard's drag used to make with
 * `document.elementFromPoint`, and it is here — pure, synchronous, no DOM —
 * because that approach could not be made to behave:
 *
 * - **Most of the grid is not a panel.** The layout uses `align-items: start`
 *   over 8px rows, so a panel occupies only as much of its column as its content
 *   needs. Point-hit-testing during a real drag found no panel at all in 97% of
 *   samples (it returned the grid container), so the layout mostly did not
 *   respond, then lurched when the pointer happened to cross a card.
 * - **A bare midpoint test has no memory.** Sitting near a boundary, a pixel of
 *   jitter flips the answer, and the order swaps back and forth.
 *
 * Both are fixed by asking a different question. Instead of "what is underneath
 * the cursor", this resolves "which panel is the cursor nearest", and remembers
 * what it last decided so small movements cannot undo it.
 *
 * Everything here is measured in viewport coordinates, matching
 * `getBoundingClientRect`.
 */

/** One panel's box, as measured from the grid. */
export interface PanelRect {
  /** The widget id this box belongs to. */
  id: string;
  /** Left edge, viewport coordinates. */
  x: number;
  /** Top edge, viewport coordinates. */
  y: number;
  /** Box width in px. */
  width: number;
  /** Box height in px. */
  height: number;
}

/** What the drag last settled on, carried between steps. */
export interface DragTarget {
  /** The panel the dragged one is being placed relative to. */
  id: string;
  /** `true` when it goes after that panel, `false` when before. */
  after: boolean;
}

/** One step's inputs. */
export interface DragStep {
  /** Panel boxes. The dragged panel may be included; it is ignored. */
  rects: PanelRect[];
  /** Pointer x, viewport coordinates. */
  x: number;
  /** Pointer y, viewport coordinates. */
  y: number;
  /** The panel being dragged. */
  draggedId: string;
  /** The order as it currently stands. */
  order: string[];
  /** What the previous step returned, or `null` at the start of a drag. */
  target: DragTarget | null;
}

/** One step's result. */
export interface DragResult {
  /**
   * The order to apply. **The same array reference as the input** when nothing
   * should move, so the caller can skip the state update entirely — which is
   * what keeps a drag from re-rendering on every pointer event.
   */
  order: string[];
  /** The target to pass into the next step. */
  target: DragTarget | null;
}

/**
 * How far past a panel's midpoint the pointer must travel to flip which side
 * the dragged panel lands on, as a fraction of that panel's width or height.
 *
 * This is the damping. At 0 the boundary is a knife edge and jitter thrashes it;
 * too high and the panel feels like it is ignoring you. 0.12 means a 300px-wide
 * panel needs ~36px of committed travel to change its mind, which is far more
 * than jitter and far less than a deliberate move.
 */
export const FLIP_HYSTERESIS = 0.12;

/**
 * A ceiling on that dead band, in px.
 *
 * The fraction alone does not survive contact with this grid: panels here run to
 * ~700px wide, where 12% is 84px of committed travel before the card will change
 * sides. Measured against a real drag that reads as the panel ignoring you — the
 * gesture produced no reorders at all. Jitter is 1–3px, so a couple of dozen
 * pixels is already far beyond it, and the fraction only matters for panels
 * narrow enough that 24px would be most of their width.
 */
export const FLIP_HYSTERESIS_MAX = 24;

/**
 * How far outside the current target's box the pointer must go before another
 * panel can take over, in px.
 *
 * Separate from {@link FLIP_HYSTERESIS} because it damps a different thing: that
 * one stops the *side* flapping, this stops the *target* flapping when the
 * pointer sits near where two panels meet.
 */
export const TARGET_STICKINESS = 24;

/** How far a point is from a box — 0 when inside it. */
function distanceTo(rect: PanelRect, x: number, y: number): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/** Whether a point is inside a box, optionally with a margin around it. */
function contains(rect: PanelRect, x: number, y: number, margin = 0): boolean {
  return (
    x >= rect.x - margin &&
    x <= rect.x + rect.width + margin &&
    y >= rect.y - margin &&
    y <= rect.y + rect.height + margin
  );
}

/**
 * The panel the pointer is over, or — since most of the grid is empty space —
 * the nearest one.
 *
 * Resolving to the nearest panel rather than to nothing is what removes the dead
 * zones: the gap between two cards, and the large empty region a short panel
 * leaves in its column, both now belong to whichever card is closest.
 *
 * @param rects - Candidate boxes. The dragged panel should already be excluded.
 * @returns The closest panel, or `null` when there are no candidates.
 */
export function resolveTarget(rects: PanelRect[], x: number, y: number): PanelRect | null {
  let best: PanelRect | null = null;
  let bestDistance = Infinity;
  for (const rect of rects) {
    const distance = distanceTo(rect, x, y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = rect;
    }
  }
  return best;
}

/**
 * Which side of `rect` the pointer is on.
 *
 * Which axis decides depends on how the panels sit, and a grid can do both: when
 * the pointer is inside the target's vertical band the two are side by side, so
 * the horizontal midpoint is the meaningful one; otherwise they are stacked and
 * the vertical midpoint is. A vertical-only test cannot express a row.
 *
 * @param previous - What was decided last time for this same panel, or `null`.
 *   When present, the pointer must clear {@link FLIP_HYSTERESIS} past the
 *   midpoint to change the answer.
 */
export function sideOf(
  rect: PanelRect,
  x: number,
  y: number,
  previous: boolean | null = null,
): boolean {
  const sideBySide = y >= rect.y && y <= rect.y + rect.height;
  const value = sideBySide ? x : y;
  const extent = sideBySide ? rect.width : rect.height;
  const middle = (sideBySide ? rect.x : rect.y) + extent / 2;

  if (previous === null) return value > middle;

  // Already committed to a side: only a decisive move flips it.
  const margin = Math.min(extent * FLIP_HYSTERESIS, FLIP_HYSTERESIS_MAX);
  if (previous && value < middle - margin) return false;
  if (!previous && value > middle + margin) return true;
  return previous;
}

/** Places `draggedId` next to `target` in `order`. */
function placed(order: string[], draggedId: string, target: DragTarget): string[] {
  const next = order.filter((id) => id !== draggedId);
  const at = next.indexOf(target.id);
  if (at < 0) return order;
  next.splice(target.after ? at + 1 : at, 0, draggedId);
  return next;
}

/** Whether two orders are the same sequence. */
function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Advances a drag by one pointer position.
 *
 * Returns `step.order` unchanged — by reference — whenever nothing should move,
 * which is the common case and the reason a drag no longer re-renders on every
 * event.
 *
 * @param step - See {@link DragStep}.
 * @returns The order to apply and the target to carry forward.
 */
export function stepDrag(step: DragStep): DragResult {
  const { rects, x, y, draggedId, order, target } = step;
  const candidates = rects.filter((rect) => rect.id !== draggedId);
  if (candidates.length === 0) return { order, target };

  // Hold the current target until the pointer has genuinely left it. Without
  // this the target changes the instant a reorder shuffles the panels, and the
  // next move undoes the previous one.
  const held =
    target && candidates.find((rect) => rect.id === target.id && contains(rect, x, y, TARGET_STICKINESS));

  const rect = held ?? resolveTarget(candidates, x, y);
  if (!rect) return { order, target };

  const previous = target && target.id === rect.id ? target.after : null;
  const next: DragTarget = { id: rect.id, after: sideOf(rect, x, y, previous) };

  // Nothing moved and nothing changed its mind: hand back the same reference.
  if (target && target.id === next.id && target.after === next.after) return { order, target };

  const reordered = placed(order, draggedId, next);
  return { order: same(reordered, order) ? order : reordered, target: next };
}
