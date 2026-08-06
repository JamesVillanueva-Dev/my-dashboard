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

/** One step, with `dragged` moving and `target` carried in. */
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

  it('is null when there is nothing to resolve to', () => {
    expect(resolveTarget([], 10, 10)).toBeNull();
  });
});

describe('sideOf', () => {
  const a = rects[0];

  it('uses the horizontal midpoint when the panels sit side by side', () => {
    expect(sideOf(a, 100, 100)).toBe(false);
    expect(sideOf(a, 200, 100)).toBe(true);
  });

  it('uses the vertical midpoint when they are stacked', () => {
    // Outside the target's vertical band, so this is an above/below question.
    expect(sideOf(a, 150, -50)).toBe(false);
    expect(sideOf(a, 150, 260)).toBe(true);
  });

  /** The dead band actually in force for this panel: the fraction, capped. */
  const margin = Math.min(a.width * FLIP_HYSTERESIS, FLIP_HYSTERESIS_MAX);

  it('keeps its previous answer for small movements past the midpoint', () => {
    // Just over the midpoint, having previously decided "before": not enough.
    expect(sideOf(a, 150 + margin - 1, 100, false)).toBe(false);
    // Decisively past it: flips.
    expect(sideOf(a, 150 + margin + 1, 100, false)).toBe(true);
  });

  it('flips back only on a decisive move the other way', () => {
    expect(sideOf(a, 150 - margin + 1, 100, true)).toBe(true);
    expect(sideOf(a, 150 - margin - 1, 100, true)).toBe(false);
  });

  it('caps the dead band in pixels, so a wide panel does not ignore you', () => {
    // 12% of a 700px panel is 84px of committed travel before it changes sides.
    // Measured against the real grid, that read as the drag not responding.
    const wide = { id: 'w', x: 0, y: 0, width: 700, height: 200 };
    expect(sideOf(wide, 350 + FLIP_HYSTERESIS_MAX + 1, 100, false)).toBe(true);
  });
});

describe('stepDrag', () => {
  it('returns the same order reference when nothing should move', () => {
    // Reference equality is the contract: it is what lets the caller skip
    // setLayout entirely rather than re-rendering on every pointer event.
    const target: DragTarget = { id: 'a', after: false };
    const result = stepDrag({ rects, x: 100, y: 100, draggedId: 'c', order, target });
    expect(result.order).toBe(order);
  });

  it('places the dragged panel before a target on its near side', () => {
    const result = step(100, 100);
    expect(result.order).toEqual(['c', 'a', 'b']);
    expect(result.target).toEqual({ id: 'a', after: false });
  });

  it('places it after a target on the far side', () => {
    const result = step(250, 100);
    expect(result.order).toEqual(['a', 'c', 'b']);
    expect(result.target).toEqual({ id: 'a', after: true });
  });

  it('never places a panel against itself', () => {
    // Pointer squarely inside `a` while dragging `a`: it has to resolve to some
    // *other* panel, and every id must survive.
    const result = stepDrag({ rects, x: 150, y: 100, draggedId: 'a', order, target: null });
    expect(result.target?.id).not.toBe('a');
    expect([...result.order].sort()).toEqual(['a', 'b', 'c']);
  });

  it('does nothing when there is no other panel to place against', () => {
    const solo = [{ id: 'a', x: 0, y: 0, width: 300, height: 200 }];
    const only = ['a'];
    const result = stepDrag({ rects: solo, x: 10, y: 10, draggedId: 'a', order: only, target: null });
    expect(result.order).toBe(only);
    expect(result.target).toBeNull();
  });

  /**
   * The point of the whole module. A pointer wobbling either side of a boundary
   * is the gesture that used to make the layout thrash; it must commit once.
   */
  it('commits exactly one reorder for a jitter sequence around a boundary', () => {
    let current = order;
    let target: DragTarget | null = null;
    let reorders = 0;

    // 40 samples oscillating ±3px across a's horizontal midpoint.
    for (let i = 0; i < 40; i++) {
      const x = 150 + (i % 2 === 0 ? 3 : -3);
      const result = stepDrag({ rects, x, y: 100, draggedId: 'c', order: current, target });
      if (result.order !== current) reorders++;
      current = result.order;
      target = result.target;
    }

    expect(reorders).toBe(1);
  });

  it('still follows a deliberate sweep across the boundary, both ways', () => {
    let current = order;
    let target: DragTarget | null = null;
    const seen: string[][] = [];

    // Well past the hysteresis margin in each direction.
    for (const x of [60, 240, 60, 240]) {
      const result = stepDrag({ rects, x, y: 100, draggedId: 'c', order: current, target });
      if (result.order !== current) seen.push(result.order);
      current = result.order;
      target = result.target;
    }

    expect(seen).toEqual([
      ['c', 'a', 'b'],
      ['a', 'c', 'b'],
      ['c', 'a', 'b'],
      ['a', 'c', 'b'],
    ]);
  });

  it('holds its target while the pointer lingers just outside it', () => {
    // A reorder shuffles the panels under the cursor. Without stickiness the
    // target changes immediately and the next move undoes the last one.
    const target: DragTarget = { id: 'b', after: false };
    const result = stepDrag({ rects, x: 306, y: 100, draggedId: 'c', order, target });
    expect(result.target?.id).toBe('b');
  });

  it('hands the target over once the pointer clearly leaves', () => {
    const target: DragTarget = { id: 'b', after: false };
    const result = stepDrag({ rects, x: 150, y: 100, draggedId: 'c', order, target });
    expect(result.target?.id).toBe('a');
  });
});
