import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWidgetLayout } from './useWidgetLayout';
import { DEFAULT_LAYOUT } from '../lib/registry';

/**
 * A stand-in keyboard event. The handlers read only `key` and call
 * `preventDefault`, so nothing else needs to exist.
 */
function key(name: string) {
  return { key: name, preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
}

/** The stored size map, as it sits in localStorage. */
function storedSizes(): Record<string, { cols: number; height: number | null }> {
  return JSON.parse(localStorage.getItem('widget.sizes') ?? '{}');
}

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

describe('useWidgetLayout', () => {
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

    it('adds a widget that is off and removes one that is on', () => {
      const { result } = renderHook(() => useWidgetLayout());
      expect(result.current.enabled).not.toContain('spotify');

      act(() => result.current.toggle('spotify'));
      expect(result.current.enabled).toContain('spotify');

      act(() => result.current.toggle('spotify'));
      expect(result.current.enabled).not.toContain('spotify');
    });

    it('removes a widget and persists the shorter layout', () => {
      const { result } = renderHook(() => useWidgetLayout());
      act(() => result.current.remove('notes'));

      expect(result.current.enabled).not.toContain('notes');
      expect(JSON.parse(localStorage.getItem('layout')!)).not.toContain('notes');
    });

    it('restores the default order and clears every stored size on reset', () => {
      const { result } = renderHook(() => useWidgetLayout());
      act(() => result.current.remove('notes'));
      act(() => result.current.chromeFor('weather').onResizeKeyDown(key('ArrowRight'), 'weather'));
      expect(storedSizes()).not.toEqual({});

      act(() => result.current.reset());

      expect(result.current.enabled).toEqual(DEFAULT_LAYOUT);
      expect(storedSizes()).toEqual({});
    });

    it('keeps a retired id in storage rather than silently rewriting the layout', () => {
      // `enabled` filters for display; the saved order is left alone, so a widget
      // that comes back later returns to the position the user put it in.
      localStorage.setItem('layout', JSON.stringify(['notes', 'todo', 'weather']));
      const { result } = renderHook(() => useWidgetLayout());

      act(() => result.current.remove('notes'));
      expect(JSON.parse(localStorage.getItem('layout')!)).toEqual(['todo', 'weather']);
    });
  });

  describe('keyboard reordering', () => {
    it('moves a widget later with ArrowDown and announces its new position', () => {
      const { result } = renderHook(() => useWidgetLayout());
      const first = result.current.enabled[0];
      const second = result.current.enabled[1];

      act(() => result.current.chromeFor(first).onGripKeyDown(key('ArrowDown'), first));

      expect(result.current.enabled[0]).toBe(second);
      expect(result.current.enabled[1]).toBe(first);
      expect(result.current.announcement).toBe(
        `Tasks moved to position 2 of ${DEFAULT_LAYOUT.length}`,
      );
    });

    it('treats ArrowUp and ArrowLeft as the same backwards move', () => {
      const { result } = renderHook(() => useWidgetLayout());
      const [, second] = result.current.enabled;

      act(() => result.current.chromeFor(second).onGripKeyDown(key('ArrowLeft'), second));
      expect(result.current.enabled[0]).toBe(second);
    });

    it('will not move the first widget above the top', () => {
      const { result } = renderHook(() => useWidgetLayout());
      const before = [...result.current.enabled];

      act(() => result.current.chromeFor(before[0]).onGripKeyDown(key('ArrowUp'), before[0]));

      expect(result.current.enabled).toEqual(before);
      expect(result.current.announcement).toBe(`Tasks moved to position 1 of ${before.length}`);
    });

    it('ignores keys that are not arrows, so the grip stays a normal button', () => {
      const { result } = renderHook(() => useWidgetLayout());
      const before = [...result.current.enabled];
      const event = key('Enter');

      act(() => result.current.chromeFor(before[0]).onGripKeyDown(event, before[0]));

      expect(result.current.enabled).toEqual(before);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('persists the new order', () => {
      const { result } = renderHook(() => useWidgetLayout());
      const first = result.current.enabled[0];

      act(() => result.current.chromeFor(first).onGripKeyDown(key('ArrowDown'), first));

      expect(JSON.parse(localStorage.getItem('layout')!)[1]).toBe(first);
    });
  });

  describe('keyboard resizing', () => {
    it('widens a panel by one column and says so', () => {
      const { result } = renderHook(() => useWidgetLayout());
      // 'notes' is a one-column widget by default.
      act(() => result.current.chromeFor('notes').onResizeKeyDown(key('ArrowRight'), 'notes'));

      expect(result.current.chromeFor('notes').size.cols).toBe(2);
      expect(result.current.announcement).toBe(
        'Notes resized to 2 columns wide, height fits the content',
      );
    });

    it('says "column" rather than "columns" at a width of one', () => {
      const { result } = renderHook(() => useWidgetLayout());
      act(() => result.current.chromeFor('news').onResizeKeyDown(key('ArrowLeft'), 'news'));
      expect(result.current.announcement).toBe(
        'News resized to 1 column wide, height fits the content',
      );
    });

    it('will not narrow a panel past a single column', () => {
      const { result } = renderHook(() => useWidgetLayout());
      act(() => result.current.chromeFor('notes').onResizeKeyDown(key('ArrowLeft'), 'notes'));
      expect(result.current.chromeFor('notes').size.cols).toBe(1);
    });

    it('will not widen a panel past the columns the grid has', () => {
      const { result } = renderHook(() => useWidgetLayout());
      // jsdom reports no tracks, so the ceiling stays at MAX_COLS (6).
      for (let i = 0; i < 10; i++) {
        act(() => result.current.chromeFor('notes').onResizeKeyDown(key('ArrowRight'), 'notes'));
      }
      expect(result.current.chromeFor('notes').size.cols).toBe(6);
    });

    it('grows a pinned height from the height the panel is actually showing', () => {
      const { result } = renderHook(() => useWidgetLayout());
      registerPanel(result.current, 'notes', 200);

      act(() => result.current.chromeFor('notes').onResizeKeyDown(key('ArrowDown'), 'notes'));

      // 200 rendered + one 24px step, rather than a jump from zero.
      expect(result.current.chromeFor('notes').size.height).toBe(224);
      expect(result.current.announcement).toBe('Notes resized to 1 column wide, 224 pixels tall');
    });

    it('shrinks a pinned height and clamps it at the minimum', () => {
      const { result } = renderHook(() => useWidgetLayout());
      registerPanel(result.current, 'notes', 130);

      act(() => result.current.chromeFor('notes').onResizeKeyDown(key('ArrowUp'), 'notes'));
      expect(result.current.chromeFor('notes').size.height).toBe(120);

      act(() => result.current.chromeFor('notes').onResizeKeyDown(key('ArrowUp'), 'notes'));
      expect(result.current.chromeFor('notes').size.height).toBe(120);
    });

    it('unpins the height with Enter, the keyboard equivalent of the fit button', () => {
      const { result } = renderHook(() => useWidgetLayout());
      registerPanel(result.current, 'notes', 200);

      act(() => result.current.chromeFor('notes').onResizeKeyDown(key('ArrowDown'), 'notes'));
      expect(result.current.chromeFor('notes').size.height).toBe(224);

      act(() => result.current.chromeFor('notes').onResizeKeyDown(key('Enter'), 'notes'));
      expect(result.current.chromeFor('notes').size.height).toBeNull();
    });

    it('unpins the height from the fit control too', () => {
      const { result } = renderHook(() => useWidgetLayout());
      registerPanel(result.current, 'notes', 200);

      act(() => result.current.chromeFor('notes').onResizeKeyDown(key('ArrowDown'), 'notes'));
      act(() => result.current.chromeFor('notes').onFitHeight('notes'));

      expect(result.current.chromeFor('notes').size.height).toBeNull();
      expect(result.current.chromeFor('notes').size.cols).toBe(1);
    });

    it('ignores keys it has no meaning for', () => {
      const { result } = renderHook(() => useWidgetLayout());
      const event = key('Escape');

      act(() => result.current.chromeFor('notes').onResizeKeyDown(event, 'notes'));

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(storedSizes()).toEqual({});
    });

    it('persists a resize', () => {
      const { result } = renderHook(() => useWidgetLayout());
      act(() => result.current.chromeFor('notes').onResizeKeyDown(key('ArrowRight'), 'notes'));
      expect(storedSizes().notes).toEqual({ cols: 2, height: null });
    });

    it('reads back the named widths saved before panels were freely resizable', () => {
      localStorage.setItem('widget.sizes', JSON.stringify({ notes: 'wide', weather: 'compact' }));
      const { result } = renderHook(() => useWidgetLayout());

      expect(result.current.chromeFor('notes').size).toEqual({ cols: 3, height: null });
      expect(result.current.chromeFor('weather').size).toEqual({ cols: 1, height: null });
    });

    it('falls back to the registry default for a junk stored size', () => {
      localStorage.setItem('widget.sizes', JSON.stringify({ news: 'enormous' }));
      const { result } = renderHook(() => useWidgetLayout());
      expect(result.current.chromeFor('news').size.cols).toBe(2);
    });
  });

  describe('the chrome handed to each panel', () => {
    it('reports neither dragging nor resizing at rest', () => {
      const { result } = renderHook(() => useWidgetLayout());
      const chrome = result.current.chromeFor('notes');

      expect(chrome.id).toBe('notes');
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
      const { result } = renderHook(() => useWidgetLayout());
      registerPanel(result.current, 'notes', 200);
      act(() => result.current.registerItem('notes')(null));

      // With no element to measure, a first vertical press starts from zero and
      // lands on the minimum height rather than throwing.
      act(() => result.current.chromeFor('notes').onResizeKeyDown(key('ArrowDown'), 'notes'));
      expect(result.current.chromeFor('notes').size.height).toBe(120);
    });
  });
});
