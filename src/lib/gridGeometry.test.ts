import { describe, it, expect, vi, afterEach } from 'vitest';
import { applySize, applySpan, gridMetrics, layoutRect, translation } from './gridGeometry';

/** A grid element whose computed style reports the given track values. */
function gridWith(style: Partial<CSSStyleDeclaration>): HTMLElement {
  const el = document.createElement('div');
  vi.spyOn(window, 'getComputedStyle').mockReturnValue(style as CSSStyleDeclaration);
  return el;
}

/** An element reporting a fixed bounding box, for measurement tests. */
function boxed(rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, ...rect }) as DOMRect;
  return el;
}

/**
 * A stand-in for the real `DOMMatrixReadOnly`, which jsdom does not implement.
 *
 * Without it every transform reads as "none" here, so the correction in
 * {@link layoutRect} — the part most worth testing — would never run. Only the
 * two members the code touches are modelled.
 */
class FakeMatrix {
  m41: number;
  m42: number;
  constructor(init: string) {
    const parts = init.match(/-?[\d.]+/g);
    if (!parts || parts.length < 6) throw new SyntaxError(`unparseable transform: ${init}`);
    this.m41 = Number(parts[4]);
    this.m42 = Number(parts[5]);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('gridMetrics', () => {
  it('reads row height, gaps and column width from the computed style', () => {
    const grid = gridWith({
      gridAutoRows: '10px',
      rowGap: '16px',
      columnGap: '20px',
      gridTemplateColumns: '240px 240px 240px',
    });
    expect(gridMetrics(grid)).toEqual({
      row: 10,
      gap: 16,
      colGap: 20,
      colWidth: 240,
      columns: 3,
    });
  });

  it('falls back to the built-in row and gap when the style is unreadable', () => {
    // jsdom reports empty strings for grid properties it does not implement.
    const grid = gridWith({
      gridAutoRows: '',
      rowGap: '',
      columnGap: '',
      gridTemplateColumns: '',
    });
    const { row, gap, colGap } = gridMetrics(grid);
    expect(row).toBe(8);
    expect(gap).toBe(12);
    expect(colGap).toBe(12);
  });

  it('reports zero columns when the grid cannot be measured, rather than guessing one', () => {
    // The caller uses this to decide whether to trust the measurement at all —
    // a wrong "1" would clamp every panel down to a single column.
    const grid = gridWith({ gridTemplateColumns: '' });
    expect(gridMetrics(grid).columns).toBe(0);
    expect(gridMetrics(grid).colWidth).toBe(0);
  });

  it('uses the fallbacks for a null grid', () => {
    expect(gridMetrics(null)).toEqual({ row: 8, gap: 12, colGap: 12, colWidth: 0, columns: 0 });
  });
});

describe('translation', () => {
  it('is zero for an element with no transform', () => {
    vi.stubGlobal('DOMMatrixReadOnly', FakeMatrix);
    const el = gridWith({ transform: 'none' });
    expect(translation(el)).toEqual({ x: 0, y: 0 });
  });

  it('pulls the x and y offset out of a matrix', () => {
    vi.stubGlobal('DOMMatrixReadOnly', FakeMatrix);
    const el = gridWith({ transform: 'matrix(1, 0, 0, 1, 30, -12)' });
    expect(translation(el)).toEqual({ x: 30, y: -12 });
  });

  it('treats an unparseable transform as none instead of throwing', () => {
    vi.stubGlobal('DOMMatrixReadOnly', FakeMatrix);
    const el = gridWith({ transform: 'not-a-matrix' });
    expect(translation(el)).toEqual({ x: 0, y: 0 });
  });

  it('gives up quietly where DOMMatrixReadOnly does not exist', () => {
    // The jsdom path. Worth pinning: it is why the rendered dashboard tests see
    // untransformed boxes, and it must degrade rather than throw.
    vi.stubGlobal('DOMMatrixReadOnly', undefined);
    const el = gridWith({ transform: 'matrix(1, 0, 0, 1, 30, -12)' });
    expect(translation(el)).toEqual({ x: 0, y: 0 });
  });
});

describe('layoutRect', () => {
  it('subtracts an in-flight transform, so it reports where layout put the panel', () => {
    // This is the whole point: getBoundingClientRect() includes the transform a
    // running FLIP animation is driving, and measuring that would compound the
    // error on every reorder.
    vi.stubGlobal('DOMMatrixReadOnly', FakeMatrix);
    const el = boxed({ left: 150, top: 90, width: 200, height: 100 });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      transform: 'matrix(1, 0, 0, 1, 50, 40)',
    } as CSSStyleDeclaration);

    expect(layoutRect(el, 'notes')).toEqual({
      id: 'notes',
      x: 100,
      y: 50,
      width: 200,
      height: 100,
    });
  });

  it('reports the raw box when nothing is transformed', () => {
    const el = boxed({ left: 10, top: 20, width: 30, height: 40 });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      transform: 'none',
    } as CSSStyleDeclaration);
    expect(layoutRect(el, 'weather')).toMatchObject({ id: 'weather', x: 10, y: 20 });
  });
});

describe('applySize', () => {
  it('writes the column span and pinned height as custom properties', () => {
    const item = document.createElement('div');
    applySize(item, { cols: 2, height: 300 }, 4);
    expect(item.style.getPropertyValue('--cols')).toBe('2');
    expect(item.style.getPropertyValue('--h')).toBe('300px');
  });

  it('removes the height property when the panel should fit its content', () => {
    const item = document.createElement('div');
    applySize(item, { cols: 1, height: 300 }, 4);
    applySize(item, { cols: 1, height: null }, 4);
    expect(item.style.getPropertyValue('--h')).toBe('');
  });

  it('caps the span at the columns on screen, so a wide panel cannot overflow', () => {
    const item = document.createElement('div');
    applySize(item, { cols: 5, height: null }, 2);
    expect(item.style.getPropertyValue('--cols')).toBe('2');
  });

  it('never writes a span below one, even for a grid measured as zero columns', () => {
    const item = document.createElement('div');
    applySize(item, { cols: 3, height: null }, 0);
    expect(item.style.getPropertyValue('--cols')).toBe('1');
  });
});

describe('applySpan', () => {
  /** An item wrapping a card of the given height, inside an unmeasurable grid. */
  function itemOfHeight(height: number): HTMLElement {
    const grid = document.createElement('div');
    const item = document.createElement('div');
    const card = document.createElement('div');
    Object.defineProperty(card, 'offsetHeight', { value: height, configurable: true });
    item.appendChild(card);
    grid.appendChild(item);
    return item;
  }

  it('spans enough rows to cover the card, rounding up', () => {
    // Fallbacks: 8px rows, 12px gaps. (100 + 12) / (8 + 12) = 5.6 -> 6.
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({} as CSSStyleDeclaration);
    const item = itemOfHeight(100);
    applySpan(item);
    expect(item.style.gridRowEnd).toBe('span 6');
  });

  it('always spans at least one row', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({} as CSSStyleDeclaration);
    const item = itemOfHeight(0);
    applySpan(item);
    expect(item.style.gridRowEnd).toBe('span 1');
  });

  it('does nothing for an item with no card inside it', () => {
    const item = document.createElement('div');
    applySpan(item);
    expect(item.style.gridRowEnd).toBe('');
  });
});
