import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LAYOUT,
  MAX_COLS,
  MAX_HEIGHT,
  MIN_COLS,
  MIN_HEIGHT,
  WIDGETS,
  clampCols,
  clampHeight,
  normalizeSize,
  widgetById,
} from './registry';

describe('clampCols', () => {
  it('rounds a dragged fraction of a column to the nearest whole one', () => {
    expect(clampCols(2.4)).toBe(2);
    expect(clampCols(2.6)).toBe(3);
  });

  it('never goes below one column or above the stored ceiling', () => {
    expect(clampCols(-3)).toBe(MIN_COLS);
    expect(clampCols(99)).toBe(MAX_COLS);
  });

  it('caps at the columns the grid actually has, so a panel cannot overflow', () => {
    expect(clampCols(5, 3)).toBe(3);
    // A single-column grid still has room for a one-column panel.
    expect(clampCols(4, 1)).toBe(1);
    // A grid measured as having no columns must not clamp widths away to zero.
    expect(clampCols(2, 0)).toBe(1);
  });
});

describe('clampHeight', () => {
  it('keeps a dragged height within the usable range', () => {
    expect(clampHeight(300)).toBe(300);
    expect(clampHeight(10)).toBe(MIN_HEIGHT);
    expect(clampHeight(9999)).toBe(MAX_HEIGHT);
  });
});

describe('normalizeSize', () => {
  it('reads a stored size back', () => {
    expect(normalizeSize({ cols: 3, height: 240 }, 1)).toEqual({ cols: 3, height: 240 });
  });

  it('translates the named widths saved before panels were freely resizable', () => {
    expect(normalizeSize('compact', 2)).toEqual({ cols: 1, height: null });
    expect(normalizeSize('standard', 1)).toEqual({ cols: 2, height: null });
    expect(normalizeSize('wide', 1)).toEqual({ cols: 3, height: null });
  });

  it("falls back to the widget's default width when there is nothing stored", () => {
    expect(normalizeSize(undefined, 2)).toEqual({ cols: 2, height: null });
    expect(normalizeSize('hero', 2)).toEqual({ cols: 2, height: null });
  });

  it('repairs a stored size that is out of range or the wrong shape', () => {
    expect(normalizeSize({ cols: 99, height: 5 }, 2)).toEqual({
      cols: MAX_COLS,
      height: MIN_HEIGHT,
    });
    expect(normalizeSize({ height: 'tall' }, 2)).toEqual({ cols: 2, height: null });
  });
});

describe('WIDGETS', () => {
  it('has unique ids — the saved layout addresses widgets by id alone', () => {
    const ids = WIDGETS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('omits the three retired ids', () => {
    const ids = WIDGETS.map((w) => w.id);
    expect(ids).not.toContain('todo');
    expect(ids).not.toContain('focus');
    expect(ids).not.toContain('quicklinks');
  });

  it('gives every widget a title, an icon, a default width, and a renderer', () => {
    for (const w of WIDGETS) {
      expect(w.title).toBeTruthy();
      expect(w.icon).toBeTruthy();
      expect(w.cols).toBe(clampCols(w.cols));
      expect(typeof w.render).toBe('function');
    }
  });
});

describe('DEFAULT_LAYOUT', () => {
  it('enables every widget that is not opt-in, in catalogue order', () => {
    expect(DEFAULT_LAYOUT).toEqual(WIDGETS.filter((w) => !w.defaultOff).map((w) => w.id));
  });

  it('leaves Spotify off, and offers YouTube as the music panel instead', () => {
    expect(DEFAULT_LAYOUT).not.toContain('spotify');
    expect(DEFAULT_LAYOUT).toContain('youtube');
    // Off by default, but still in the catalogue so the widget menu can offer it.
    expect(widgetById('spotify')?.title).toBe('Spotify');
  });
});

describe('widgetById', () => {
  it('finds a widget by its id', () => {
    expect(widgetById('notes')?.title).toBe('Notes');
  });

  it('returns undefined for an id no longer in the catalogue', () => {
    // A saved layout from an older version can still name these; the dashboard
    // relies on the lookup missing so it can filter them out.
    expect(widgetById('todo')).toBeUndefined();
    expect(widgetById('quicklinks')).toBeUndefined();
  });
});
