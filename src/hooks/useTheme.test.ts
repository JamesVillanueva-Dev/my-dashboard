import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTheme } from './useTheme';
import { themeById, type ThemePreference } from '../lib/themes';

/** Listeners registered on the OS colour-scheme query. */
let listeners: ((e: MediaQueryListEvent) => void)[] = [];

/** Installs a `matchMedia` that reports the given OS preference. */
function stubMatchMedia(prefersDark: boolean) {
  listeners = [];
  window.matchMedia = ((query: string) => ({
    matches: prefersDark,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.push(fn),
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners = listeners.filter((l) => l !== fn);
    },
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

/** Fires an OS colour-scheme change at whatever the hook registered. */
function changeSystemTo(dark: boolean) {
  act(() => {
    for (const fn of [...listeners]) fn({ matches: dark } as MediaQueryListEvent);
  });
}

function favicon() {
  return document.querySelector<HTMLLinkElement>('link[rel="icon"]');
}

beforeEach(() => {
  stubMatchMedia(false);
  favicon()?.remove();
});

describe('useTheme', () => {
  it('follows the system by default', () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current.preference).toBe('system');
  });

  it('resolves "system" to light when the OS does not prefer dark', () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current).toMatchObject({ system: 'light', theme: 'light' });
  });

  it('resolves "system" to dark when the OS prefers dark', () => {
    stubMatchMedia(true);

    const { result } = renderHook(() => useTheme());

    expect(result.current).toMatchObject({ system: 'dark', theme: 'dark' });
  });

  it('reads a stored preference', () => {
    localStorage.setItem('theme', JSON.stringify('forest'));

    const { result } = renderHook(() => useTheme());

    expect(result.current).toMatchObject({ preference: 'forest', theme: 'forest' });
  });

  it('keeps a preference saved by the old light/dark toggle working', () => {
    localStorage.setItem('theme', JSON.stringify('dark'));

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');
  });

  it('falls back to the system palette for a preference that no longer exists', () => {
    stubMatchMedia(true);
    localStorage.setItem('theme', JSON.stringify('retired-theme'));

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');
  });

  describe('setPreference', () => {
    it('persists the choice and applies it at once', () => {
      const { result } = renderHook(() => useTheme());

      act(() => result.current.setPreference('rose'));

      expect(result.current).toMatchObject({ preference: 'rose', theme: 'rose' });
      expect(JSON.parse(localStorage.getItem('theme')!)).toBe('rose');
    });

    it('can be handed back to the system', () => {
      stubMatchMedia(true);
      localStorage.setItem('theme', JSON.stringify('rose'));
      const { result } = renderHook(() => useTheme());

      act(() => result.current.setPreference('system'));

      expect(result.current.theme).toBe('dark');
    });
  });

  describe('applying the palette', () => {
    it('writes the resolved palette to the document root', () => {
      const { result } = renderHook(() => useTheme());

      act(() => result.current.setPreference('ocean'));

      // The `data-theme` block's variables outrank the prefers-color-scheme query.
      expect(document.documentElement).toHaveAttribute('data-theme', 'ocean');
    });

    it('resolves "system" before writing the attribute', () => {
      stubMatchMedia(true);

      renderHook(() => useTheme());

      expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    });
  });

  describe('the favicon', () => {
    it('adds an icon link drawn in the palette’s colours', () => {
      const { result } = renderHook(() => useTheme());

      act(() => result.current.setPreference('forest'));

      const { bg, accent } = themeById('forest');
      const href = favicon()!.href;
      expect(favicon()).toHaveAttribute('type', 'image/svg+xml');
      expect(href.startsWith('data:image/svg+xml,')).toBe(true);
      expect(decodeURIComponent(href)).toContain(bg);
      expect(decodeURIComponent(href)).toContain(accent);
    });

    it('reuses the existing link rather than stacking up new ones', () => {
      const existing = document.createElement('link');
      existing.rel = 'icon';
      existing.href = 'old.ico';
      document.head.appendChild(existing);

      const { result } = renderHook(() => useTheme());
      act(() => result.current.setPreference('rose'));

      expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
      expect(existing.href).not.toBe('old.ico');
    });

    it('redraws when the palette changes', () => {
      const { result } = renderHook(() => useTheme());
      act(() => result.current.setPreference('rose'));
      const rose = favicon()!.href;

      act(() => result.current.setPreference('ocean'));

      expect(favicon()!.href).not.toBe(rose);
    });
  });

  describe('tracking the OS setting', () => {
    it('follows a live switch while the preference is "system"', () => {
      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('light');

      // A scheduled light/dark switch, with no reload.
      changeSystemTo(true);

      expect(result.current).toMatchObject({ system: 'dark', theme: 'dark' });
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    });

    it('leaves a pinned palette alone, but keeps reporting what the OS wants', () => {
      const { result } = renderHook(() => useTheme());
      act(() => result.current.setPreference('rose'));

      changeSystemTo(true);

      expect(result.current.theme).toBe('rose');
      // Still tracked, so the "Follow system" option can be labelled correctly.
      expect(result.current.system).toBe('dark');
    });

    it('stops listening once unmounted', () => {
      const { unmount } = renderHook(() => useTheme());
      expect(listeners).toHaveLength(1);

      unmount();

      expect(listeners).toHaveLength(0);
    });

    it('copes with a browser that cannot report the OS setting', () => {
      // `matchMedia` is absent in some embedded webviews.
      (window as { matchMedia?: unknown }).matchMedia = undefined;

      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('light');
    });
  });

  it('survives a corrupt stored preference', () => {
    localStorage.setItem('theme', '{not json');

    const { result } = renderHook(() => useTheme());

    expect(result.current.preference).toBe('system' satisfies ThemePreference);
    expect(result.current.theme).toBe('light');
  });
});
