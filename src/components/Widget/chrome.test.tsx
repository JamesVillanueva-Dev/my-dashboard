import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { WidgetChromeProvider, useWidgetChrome, type WidgetChrome } from './chrome';

/** Chrome as the dashboard grid supplies it, overridable per test. */
function chrome(overrides: Partial<WidgetChrome> = {}): WidgetChrome {
  return {
    id: 'weather',
    size: { cols: 2, height: null },
    onResizeStart: vi.fn(),
    onResizeKeyDown: vi.fn(),
    onFitHeight: vi.fn(),
    onRemove: vi.fn(),
    onGrab: vi.fn(),
    onGripKeyDown: vi.fn(),
    isDragging: false,
    isResizing: false,
    ...overrides,
  };
}

/** Reads the chrome from inside a provider, as a widget in the grid does. */
function readInGrid(value: WidgetChrome) {
  function wrapper({ children }: { children: ReactNode }) {
    return <WidgetChromeProvider value={value}>{children}</WidgetChromeProvider>;
  }
  return renderHook(() => useWidgetChrome(), { wrapper });
}

describe('useWidgetChrome', () => {
  it('reports no chrome outside the grid, so a widget can render standalone', () => {
    const { result } = renderHook(() => useWidgetChrome());

    expect(result.current).toBeNull();
  });

  it('hands the surrounding chrome through untouched', () => {
    const value = chrome();

    const { result } = readInGrid(value);

    expect(result.current).toBe(value);
  });

  it('gives each panel its own id and size', () => {
    const weather = readInGrid(chrome({ id: 'weather', size: { cols: 1, height: 300 } }));
    const news = readInGrid(chrome({ id: 'news', size: { cols: 3, height: null } }));

    expect(weather.result.current).toMatchObject({ id: 'weather', size: { cols: 1, height: 300 } });
    expect(news.result.current).toMatchObject({ id: 'news', size: { cols: 3, height: null } });
  });

  it('follows a live update, so a drag re-renders the panel it moves', () => {
    let value = chrome({ isDragging: false });
    function wrapper({ children }: { children: ReactNode }) {
      return <WidgetChromeProvider value={value}>{children}</WidgetChromeProvider>;
    }
    const { result, rerender } = renderHook(() => useWidgetChrome(), { wrapper });
    expect(result.current?.isDragging).toBe(false);

    value = chrome({ isDragging: true });
    rerender();

    expect(result.current?.isDragging).toBe(true);
  });

  it('reads the nearest provider, since the grid wraps every panel separately', () => {
    const outer = chrome({ id: 'outer' });
    const inner = chrome({ id: 'inner' });
    function wrapper({ children }: { children: ReactNode }) {
      return (
        <WidgetChromeProvider value={outer}>
          <WidgetChromeProvider value={inner}>{children}</WidgetChromeProvider>
        </WidgetChromeProvider>
      );
    }

    const { result } = renderHook(() => useWidgetChrome(), { wrapper });

    expect(result.current).toBe(inner);
  });
});
