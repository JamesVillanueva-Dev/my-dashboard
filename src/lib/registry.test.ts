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

/** Ids that were removed from the catalogue but can still appear in a saved layout. */
const RETIRED_IDS = ['todo', 'focus', 'quicklinks'];

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
  });

  it('still allows one column on the narrowest grids', () => {
    expect(clampCols(4, 1)).toBe(1);
    // A grid measured as having no columns must not clamp widths away to zero.
    expect(clampCols(2, 0)).toBe(1);
  });
});

describe('clampHeight', () => {
  it('leaves a height inside the usable range alone', () => {
    expect(clampHeight(300)).toBe(300);
  });

  it('pulls a height outside the usable range back to the nearest limit', () => {
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

  it("falls back to the widget's default width when nothing is stored", () => {
    expect(normalizeSize(undefined, 2)).toEqual({ cols: 2, height: null });
  });

  it("falls back to the widget's default width for an unknown named width", () => {
    expect(normalizeSize('hero', 2)).toEqual({ cols: 2, height: null });
  });

  it('pulls a stored size that is out of range back into it', () => {
    expect(normalizeSize({ cols: 99, height: 5 }, 2)).toEqual({
      cols: MAX_COLS,
      height: MIN_HEIGHT,
    });
  });

  it('repairs a stored size of the wrong shape', () => {
    expect(normalizeSize({ height: 'tall' }, 2)).toEqual({ cols: 2, height: null });
  });
});

describe('WIDGETS', () => {
  it('gives every widget a unique id', () => {
    const ids = WIDGETS.map((widget) => widget.id);

    // The saved layout addresses widgets by id alone.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no longer lists the retired widgets', () => {
    const ids = WIDGETS.map((widget) => widget.id);

    for (const retiredId of RETIRED_IDS) {
      expect(ids).not.toContain(retiredId);
    }
  });

  it('gives every widget a title, an icon, a default width, and a renderer', () => {
    for (const widget of WIDGETS) {
      expect(widget.title).toBeTruthy();
      expect(widget.icon).toBeTruthy();
      expect(widget.cols).toBe(clampCols(widget.cols));
      expect(typeof widget.render).toBe('function');
    }
  });
});

describe('DEFAULT_LAYOUT', () => {
  it('enables every widget that is not opt-in, in catalogue order', () => {
    const enabledByDefault = WIDGETS.filter((widget) => !widget.defaultOff).map(
      (widget) => widget.id,
    );

    expect(DEFAULT_LAYOUT).toEqual(enabledByDefault);
  });

  it('offers YouTube as the music panel rather than Spotify', () => {
    expect(DEFAULT_LAYOUT).toContain('youtube');
    expect(DEFAULT_LAYOUT).not.toContain('spotify');
  });

  it('keeps Spotify in the catalogue so the widget menu can still offer it', () => {
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
