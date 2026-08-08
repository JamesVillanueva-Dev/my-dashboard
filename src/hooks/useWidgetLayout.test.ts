import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWidgetLayout } from './useWidgetLayout';
import { DEFAULT_LAYOUT } from '../lib/registry';

/** The widest a panel can get when the grid reports no tracks, as jsdom does. */
const MAX_COLS = 6;
/** The shortest a pinned panel can be. */
const MIN_HEIGHT = 120;
/** One vertical keypress. */
const HEIGHT_STEP = 24;

/** What `renderHook(() => useWidgetLayout())` hands back. */
type LayoutView = { result: { current: ReturnType<typeof useWidgetLayout> } };

/**
 * A stand-in keyboard event. The handlers read only `key` and call
 * `preventDefault`, so nothing else needs to exist.
 */
function keyPress(name: string) {
  return { key: name, preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
}

/** The stored size map, as it sits in localStorage. */
function storedSizes(): Record<string, { cols: number; height: number | null }> {
  return JSON.parse(localStorage.getItem('widget.sizes') ?? '{}');
}

/** The stored widget order, as it sits in localStorage. */
function storedLayout(): string[] {
  return JSON.parse(localStorage.getItem('layout')!);
}

/** Presses a key on one panel's drag grip. */
function pressGripKey(view: LayoutView, id: string, name: string) {
  const event = keyPress(name);
  act(() => view.result.current.chromeFor(id).onGripKeyDown(event, id));
  return event;
}

/** Presses a key on one panel's resize handle. */
function pressResizeKey(view: LayoutView, id: string, name: string) {
  const event = keyPress(name);
  act(() => view.result.current.chromeFor(id).onResizeKeyDown(event, id));
  return event;
}

/** The size one panel currently reports. */
const sizeOf = (view: LayoutView, id: string) => view.result.current.chromeFor(id).size;

/**
 * Registers a grid item for `id` whose card reports `height`.
 *
 * The resize handler reads the card's rendered height as the starting point for
 * the first vertical keypress, and jsdom reports 0 for every element, so a panel
 * has to be given one explicitly.
 */
function registerPanel(layout: ReturnType<typeof useWidgetLayout>, id: string, height: number) {
  const item = document.createElement('div');
  const card = document.createElement('div');
  Object.defineProperty(card, 'offsetHeight', { value: height, configurable: true });
  item.appendChild(card);
  layout.registerItem(id)(item);
  return item;
}

describe('which widgets are on the dashboard', () => {
  it('starts from the default layout', () => {
    const { result } = renderHook(() => useWidgetLayout());

    expect(result.current.enabled).toEqual(DEFAULT_LAYOUT);
  });

  it('drops ids whose widget no longer exists', () => {
    localStorage.setItem('layout', JSON.stringify(['todo', 'notes', 'focus', 'weather']));

    const { result } = renderHook(() => useWidgetLayout());

    expect(result.current.enabled).toEqual(['notes', 'weather']);
  });

  it('adds a widget that is off', () => {
    const { result } = renderHook(() => useWidgetLayout());
    expect(result.current.enabled).not.toContain('spotify');

    act(() => result.current.toggle('spotify'));

    expect(result.current.enabled).toContain('spotify');
  });

  it('removes a widget that is on', () => {
    const { result } = renderHook(() => useWidgetLayout());
    act(() => result.current.toggle('spotify'));

    act(() => result.current.toggle('spotify'));

    expect(result.current.enabled).not.toContain('spotify');
  });

  it('persists the shorter layout after a removal', () => {
    const { result } = renderHook(() => useWidgetLayout());

    act(() => result.current.remove('notes'));

    expect(result.current.enabled).not.toContain('notes');
    expect(storedLayout()).not.toContain('notes');
  });

  it('restores the default order on reset', () => {
    const view = renderHook(() => useWidgetLayout());
    act(() => view.result.current.remove('notes'));

    act(() => view.result.current.reset());

    expect(view.result.current.enabled).toEqual(DEFAULT_LAYOUT);
  });

  it('clears every stored size on reset', () => {
    const view = renderHook(() => useWidgetLayout());
    pressResizeKey(view, 'weather', 'ArrowRight');
    expect(storedSizes()).not.toEqual({});

    act(() => view.result.current.reset());

    expect(storedSizes()).toEqual({});
  });

  it('keeps a retired id in storage rather than silently rewriting the layout', () => {
    // `enabled` filters for display; the saved order is left alone, so a widget
    // that comes back later returns to the position the user put it in.
    localStorage.setItem('layout', JSON.stringify(['notes', 'todo', 'weather']));
    const { result } = renderHook(() => useWidgetLayout());

    act(() => result.current.remove('notes'));

    expect(storedLayout()).toEqual(['todo', 'weather']);
  });
});

describe('reordering widgets by keyboard', () => {
  it('moves a widget later with ArrowDown', () => {
    const view = renderHook(() => useWidgetLayout());
    const [first, second] = view.result.current.enabled;

    pressGripKey(view, first, 'ArrowDown');

    expect(view.result.current.enabled[0]).toBe(second);
    expect(view.result.current.enabled[1]).toBe(first);
  });

  it('announces the new position', () => {
    const view = renderHook(() => useWidgetLayout());
    const [first] = view.result.current.enabled;

    pressGripKey(view, first, 'ArrowDown');

    expect(view.result.current.announcement).toBe(
      `Tasks moved to position 2 of ${DEFAULT_LAYOUT.length}`,
    );
  });

  it('treats ArrowLeft as the same backwards move as ArrowUp', () => {
    const view = renderHook(() => useWidgetLayout());
    const [, second] = view.result.current.enabled;

    pressGripKey(view, second, 'ArrowLeft');

    expect(view.result.current.enabled[0]).toBe(second);
  });

  it('will not move the first widget above the top', () => {
    const view = renderHook(() => useWidgetLayout());
    const before = [...view.result.current.enabled];

    pressGripKey(view, before[0], 'ArrowUp');

    expect(view.result.current.enabled).toEqual(before);
    expect(view.result.current.announcement).toBe(`Tasks moved to position 1 of ${before.length}`);
  });

  it('ignores keys that are not arrows, so the grip stays a normal button', () => {
    const view = renderHook(() => useWidgetLayout());
    const before = [...view.result.current.enabled];

    const event = pressGripKey(view, before[0], 'Enter');

    expect(view.result.current.enabled).toEqual(before);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('persists the new order', () => {
    const view = renderHook(() => useWidgetLayout());
    const [first] = view.result.current.enabled;

    pressGripKey(view, first, 'ArrowDown');

    expect(storedLayout()[1]).toBe(first);
  });
});

describe('resizing widgets by keyboard', () => {
  it('widens a panel by one column', () => {
    const view = renderHook(() => useWidgetLayout());

    // 'notes' is a one-column widget by default.
    pressResizeKey(view, 'notes', 'ArrowRight');

    expect(sizeOf(view, 'notes').cols).toBe(2);
  });

  it('announces the new width', () => {
    const view = renderHook(() => useWidgetLayout());

    pressResizeKey(view, 'notes', 'ArrowRight');

    expect(view.result.current.announcement).toBe(
      'Notes resized to 2 columns wide, height fits the content',
    );
  });

  it('says "column" rather than "columns" at a width of one', () => {
    const view = renderHook(() => useWidgetLayout());

    pressResizeKey(view, 'news', 'ArrowLeft');

    expect(view.result.current.announcement).toBe(
      'News resized to 1 column wide, height fits the content',
    );
  });

  it('will not narrow a panel past a single column', () => {
    const view = renderHook(() => useWidgetLayout());

    pressResizeKey(view, 'notes', 'ArrowLeft');

    expect(sizeOf(view, 'notes').cols).toBe(1);
  });

  it('will not widen a panel past the columns the grid has', () => {
    const view = renderHook(() => useWidgetLayout());

    // jsdom reports no tracks, so the ceiling stays at MAX_COLS.
    for (let press = 0; press < 10; press++) pressResizeKey(view, 'notes', 'ArrowRight');

    expect(sizeOf(view, 'notes').cols).toBe(MAX_COLS);
  });

  it('grows a pinned height from the height the panel is actually showing', () => {
    const view = renderHook(() => useWidgetLayout());
    registerPanel(view.result.current, 'notes', 200);

    pressResizeKey(view, 'notes', 'ArrowDown');

    // 200 rendered + one step, rather than a jump from zero.
    expect(sizeOf(view, 'notes').height).toBe(200 + HEIGHT_STEP);
    expect(view.result.current.announcement).toBe('Notes resized to 1 column wide, 224 pixels tall');
  });

  it('shrinks a pinned height', () => {
    const view = renderHook(() => useWidgetLayout());
    registerPanel(view.result.current, 'notes', 200);

    pressResizeKey(view, 'notes', 'ArrowUp');

    expect(sizeOf(view, 'notes').height).toBe(200 - HEIGHT_STEP);
  });

  it('clamps a shrinking panel at the minimum height', () => {
    const view = renderHook(() => useWidgetLayout());
    registerPanel(view.result.current, 'notes', 130);

    pressResizeKey(view, 'notes', 'ArrowUp');
    pressResizeKey(view, 'notes', 'ArrowUp');

    expect(sizeOf(view, 'notes').height).toBe(MIN_HEIGHT);
  });

  it('unpins the height with Enter, the keyboard equivalent of the fit button', () => {
    const view = renderHook(() => useWidgetLayout());
    registerPanel(view.result.current, 'notes', 200);
    pressResizeKey(view, 'notes', 'ArrowDown');

    pressResizeKey(view, 'notes', 'Enter');

    expect(sizeOf(view, 'notes').height).toBeNull();
  });

  it('unpins the height from the fit control too, leaving the width alone', () => {
    const view = renderHook(() => useWidgetLayout());
    registerPanel(view.result.current, 'notes', 200);
    pressResizeKey(view, 'notes', 'ArrowDown');

    act(() => view.result.current.chromeFor('notes').onFitHeight('notes'));

    expect(sizeOf(view, 'notes').height).toBeNull();
    expect(sizeOf(view, 'notes').cols).toBe(1);
  });

  it('ignores keys it has no meaning for', () => {
    const view = renderHook(() => useWidgetLayout());

    const event = pressResizeKey(view, 'notes', 'Escape');

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(storedSizes()).toEqual({});
  });

  it('persists a resize', () => {
    const view = renderHook(() => useWidgetLayout());

    pressResizeKey(view, 'notes', 'ArrowRight');

    expect(storedSizes().notes).toEqual({ cols: 2, height: null });
  });

  it('reads back the named widths saved before panels were freely resizable', () => {
    localStorage.setItem('widget.sizes', JSON.stringify({ notes: 'wide', weather: 'compact' }));

    const view = renderHook(() => useWidgetLayout());

    expect(sizeOf(view, 'notes')).toEqual({ cols: 3, height: null });
    expect(sizeOf(view, 'weather')).toEqual({ cols: 1, height: null });
  });

  it('falls back to the registry default for a junk stored size', () => {
    localStorage.setItem('widget.sizes', JSON.stringify({ news: 'enormous' }));

    const view = renderHook(() => useWidgetLayout());

    expect(sizeOf(view, 'news').cols).toBe(2);
  });
});

describe('the chrome handed to each panel', () => {
  it('names the widget it belongs to', () => {
    const { result } = renderHook(() => useWidgetLayout());

    expect(result.current.chromeFor('notes').id).toBe('notes');
  });

  it('reports neither dragging nor resizing at rest', () => {
    const { result } = renderHook(() => useWidgetLayout());

    const chrome = result.current.chromeFor('notes');

    expect(chrome.isDragging).toBe(false);
    expect(chrome.isResizing).toBe(false);
    expect(result.current.dragId).toBeNull();
    expect(result.current.resizeId).toBeNull();
  });

  it('removes its own widget through onRemove', () => {
    const { result } = renderHook(() => useWidgetLayout());

    act(() => result.current.chromeFor('notes').onRemove());

    expect(result.current.enabled).not.toContain('notes');
  });

  it('forgets a panel whose element unmounts', () => {
    const view = renderHook(() => useWidgetLayout());
    registerPanel(view.result.current, 'notes', 200);

    act(() => view.result.current.registerItem('notes')(null));

    // With no element to measure, a first vertical press starts from zero and
    // lands on the minimum height rather than throwing.
    pressResizeKey(view, 'notes', 'ArrowDown');
    expect(sizeOf(view, 'notes').height).toBe(MIN_HEIGHT);
  });
});
