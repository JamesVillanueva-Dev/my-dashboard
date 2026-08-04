import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LAYOUT,
  SIZE_COLUMNS,
  WIDGETS,
  WIDGET_SIZES,
  nextSize,
  widgetById,
  type WidgetSize,
} from './registry';

describe('nextSize', () => {
  it('cycles through every size and wraps back to the start', () => {
    const seen: WidgetSize[] = [];
    let size: WidgetSize = 'compact';
    for (let i = 0; i < WIDGET_SIZES.length; i++) {
      seen.push(size);
      size = nextSize(size);
    }
    expect(seen).toEqual(WIDGET_SIZES);
    // A full lap returns to where it started, so the resize button never dead-ends.
    expect(size).toBe('compact');
  });
});

describe('SIZE_COLUMNS', () => {
  it('gives every size a column count, widening down the scale', () => {
    expect(WIDGET_SIZES.map((s) => SIZE_COLUMNS[s])).toEqual([1, 2, 3]);
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

  it('gives every widget a title, an icon, and a renderer', () => {
    for (const w of WIDGETS) {
      expect(w.title).toBeTruthy();
      expect(w.icon).toBeTruthy();
      expect(WIDGET_SIZES).toContain(w.size);
      expect(typeof w.render).toBe('function');
    }
  });
});

describe('DEFAULT_LAYOUT', () => {
  it('enables every catalogue widget, in catalogue order', () => {
    expect(DEFAULT_LAYOUT).toEqual(WIDGETS.map((w) => w.id));
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
