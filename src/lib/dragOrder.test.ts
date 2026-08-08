import { describe, it, expect } from 'vitest';
import {
  FLIP_HYSTERESIS,
  FLIP_HYSTERESIS_MAX,
  resolveTarget,
  sideOf,
  stepDrag,
  type DragTarget,
  type PanelRect,
} from './dragOrder';

/**
 * Two panels side by side, each 300×200, with a 12px gap — the dashboard's real
 * grid gap, so the "between two cards" case is the actual one.
 *
 *   a: x 0..300      b: x 312..612      (both y 0..200)
 *   c: x 0..300      (y 212..412, under a)
 */
const rects: PanelRect[] = [
  { id: 'a', x: 0, y: 0, width: 300, height: 200 },
  { id: 'b', x: 312, y: 0, width: 300, height: 200 },
  { id: 'c', x: 0, y: 212, width: 300, height: 200 },
];

const order = ['a', 'b', 'c'];

/** Panel `a`, the target most of the `sideOf` cases are measured against. */
const panelA = rects[0];

/** The horizontal midpoint of {@link panelA}, where the before/after answer flips. */
const MIDPOINT_X = 150;

/** One step of the drag, with `dragged` moving and `target` carried in from the last one. */
const step = (x: number, y: number, target: DragTarget | null = null, dragged = 'c') =>
  stepDrag({ rects, x, y, draggedId: dragged, order, target });

describe('resolveTarget', () => {
  it('finds the panel the pointer is inside', () => {
    expect(resolveTarget(rects, 150, 100)?.id).toBe('a');
    expect(resolveTarget(rects, 400, 100)?.id).toBe('b');
  });

  it('resolves the gap between two panels to the nearer one', () => {
    // The 12px gutter used to be a dead zone: elementFromPoint returned the grid
    // container and the drag simply did not respond.
    expect(resolveTarget(rects, 304, 100)?.id).toBe('a');
    expect(resolveTarget(rects, 309, 100)?.id).toBe('b');
  });

  it('resolves empty grid space to the nearest panel rather than to nothing', () => {
    // `align-items: start` leaves large empty regions below short panels. During
    // a real drag, 97% of point-hit-tests landed in space like this.
    expect(resolveTarget(rects, 450, 300)?.id).toBe('b');
    expect(resolveTarget(rects, 150, 900)?.id).toBe('c');
  });

  it('is null when there are no panels to resolve to', () => {
    expect(resolveTarget([], 10, 10)).toBeNull();
  });
});

describe('sideOf', () => {
  /** The dead band actually in force for panel `a`: the fraction, capped. */
  const margin = Math.min(panelA.width * FLIP_HYSTERESIS, FLIP_HYSTERESIS_MAX);

  it('uses the horizontal midpoint when the panels sit side by side', () => {
    expect(sideOf(panelA, 100, 100)).toBe(false);
    expect(sideOf(panelA, 200, 100)).toBe(true);
  });

  it('uses the vertical midpoint when they are stacked', () => {
    // Outside the target's vertical band, so this is an above/below question.
    expect(sideOf(panelA, 150, -50)).toBe(false);
    expect(sideOf(panelA, 150, 260)).toBe(true);
  });

  it('keeps its previous answer for a small movement past the midpoint', () => {
    expect(sideOf(panelA, MIDPOINT_X + margin - 1, 100, false)).toBe(false);
  });

  it('flips once the pointer is decisively past the midpoint', () => {
    expect(sideOf(panelA, MIDPOINT_X + margin + 1, 100, false)).toBe(true);
  });

  it('keeps its previous answer for a small movement back the other way', () => {
    expect(sideOf(panelA, MIDPOINT_X - margin + 1, 100, true)).toBe(true);
  });

  it('flips back on a decisive move the other way', () => {
    expect(sideOf(panelA, MIDPOINT_X - margin - 1, 100, true)).toBe(false);
  });

  it('caps the dead band in pixels, so a wide panel does not ignore you', () => {
    // 12% of a 700px panel is 84px of committed travel before it changes sides.
    // Measured against the real grid, that read as the drag not responding.
    const widePanel = { id: 'w', x: 0, y: 0, width: 700, height: 200 };

    expect(sideOf(widePanel, 350 + FLIP_HYSTERESIS_MAX + 1, 100, false)).toBe(true);
  });
});

describe('stepDrag', () => {
  it('returns the same order reference when nothing should move', () => {
    // Reference equality is the contract: it is what lets the caller skip
    // setLayout entirely rather than re-rendering on every pointer event.
    const unchanged = step(100, 100, { id: 'a', after: false });

    expect(unchanged.order).toBe(order);
  });

  it('places the dragged panel before a target on its near side', () => {
    const stepped = step(100, 100);

    expect(stepped.order).toEqual(['c', 'a', 'b']);
    expect(stepped.target).toEqual({ id: 'a', after: false });
  });

  it('places the dragged panel after a target on its far side', () => {
    const stepped = step(250, 100);

    expect(stepped.order).toEqual(['a', 'c', 'b']);
    expect(stepped.target).toEqual({ id: 'a', after: true });
  });

  it('never places a panel against itself', () => {
    // Pointer squarely inside `a` while dragging `a`: it has to resolve to some
    // *other* panel, and every id must survive.
    const stepped = step(150, 100, null, 'a');

    expect(stepped.target?.id).not.toBe('a');
    expect([...stepped.order].sort()).toEqual(['a', 'b', 'c']);
  });

  it('does nothing when there is no other panel to place against', () => {
    const soloRects = [{ id: 'a', x: 0, y: 0, width: 300, height: 200 }];
    const soloOrder = ['a'];

    const stepped = stepDrag({
      rects: soloRects,
      x: 10,
      y: 10,
      draggedId: 'a',
      order: soloOrder,
      target: null,
    });

    expect(stepped.order).toBe(soloOrder);
    expect(stepped.target).toBeNull();
  });

  it('commits exactly one reorder for a jitter sequence around a boundary', () => {
    // The point of the whole module. A pointer wobbling either side of a
    // boundary is the gesture that used to make the layout thrash.
    let currentOrder = order;
    let target: DragTarget | null = null;
    let reorders = 0;

    // 40 samples oscillating ±3px across a's horizontal midpoint.
    for (let sample = 0; sample < 40; sample++) {
      const x = MIDPOINT_X + (sample % 2 === 0 ? 3 : -3);
      const stepped = stepDrag({ rects, x, y: 100, draggedId: 'c', order: currentOrder, target });
      if (stepped.order !== currentOrder) reorders++;
      currentOrder = stepped.order;
      target = stepped.target;
    }

    expect(reorders).toBe(1);
  });

  it('still follows a deliberate sweep across the boundary, both ways', () => {
    let currentOrder = order;
    let target: DragTarget | null = null;
    const ordersSeen: string[][] = [];

    // Well past the hysteresis margin in each direction.
    for (const x of [60, 240, 60, 240]) {
      const stepped = stepDrag({ rects, x, y: 100, draggedId: 'c', order: currentOrder, target });
      if (stepped.order !== currentOrder) ordersSeen.push(stepped.order);
      currentOrder = stepped.order;
      target = stepped.target;
    }

    expect(ordersSeen).toEqual([
      ['c', 'a', 'b'],
      ['a', 'c', 'b'],
      ['c', 'a', 'b'],
      ['a', 'c', 'b'],
    ]);
  });

  it('holds its target while the pointer lingers just outside it', () => {
    // A reorder shuffles the panels under the cursor. Without stickiness the
    // target changes immediately and the next move undoes the last one.
    const stepped = step(306, 100, { id: 'b', after: false });

    expect(stepped.target?.id).toBe('b');
  });

  it('hands the target over once the pointer clearly leaves', () => {
    const stepped = step(150, 100, { id: 'b', after: false });

    expect(stepped.target?.id).toBe('a');
  });
});
