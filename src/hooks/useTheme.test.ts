import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTheme } from './useTheme';
import { themeById } from '../lib/themes';

/** Where the hook persists the user's choice. */
const STORAGE_KEY = 'theme';

/** What the stubbed OS reports for `prefers-color-scheme`. */
type SystemScheme = 'light' | 'dark';

/** Listeners the hook has registered on the OS colour-scheme query. */
let systemSchemeListeners: ((event: MediaQueryListEvent) => void)[] = [];

/** Installs a `matchMedia` that reports the given OS colour scheme. */
function stubSystemScheme(scheme: SystemScheme) {
  systemSchemeListeners = [];
  window.matchMedia = ((query: string) => ({
    matches: scheme === 'dark',
    media: query,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      systemSchemeListeners.push(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      systemSchemeListeners = systemSchemeListeners.filter((each) => each !== listener);
    },
  })) as unknown as typeof window.matchMedia;
}

/** Fires an OS colour-scheme change at whatever the hook registered. */
function switchSystemSchemeTo(scheme: SystemScheme) {
  act(() => {
    for (const listener of [...systemSchemeListeners]) {
      listener({ matches: scheme === 'dark' } as MediaQueryListEvent);
    }
  });
}

/** Writes a preference the way a previous visit would have left it. */
function storePreference(preference: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
}

/** The preference currently persisted. */
function storedPreference(): string {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)!);
}

/** The page's icon link, if the hook has added one. */
function faviconLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel="icon"]');
}

/** The decoded SVG source of the current favicon. */
function faviconSvg(): string {
  return decodeURIComponent(faviconLink()!.href);
}

beforeEach(() => {
  stubSystemScheme('light');
  faviconLink()?.remove();
});

describe('useTheme', () => {
  describe('the initial preference', () => {
    it('is "system" when nothing has been stored', () => {
      const { result } = renderHook(() => useTheme());

      expect(result.current.preference).toBe('system');
    });

    it('is the theme stored by a previous visit', () => {
      storePreference('forest');

      const { result } = renderHook(() => useTheme());

      expect(result.current.preference).toBe('forest');
      expect(result.current.theme).toBe('forest');
    });

    it('accepts "dark", the value the old light/dark toggle stored', () => {
      storePreference('dark');

      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('dark');
    });

    it('is "system" when the stored value is not valid JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{not json');

      const { result } = renderHook(() => useTheme());

      expect(result.current.preference).toBe('system');
      expect(result.current.theme).toBe('light');
    });
  });

  describe('resolving the preference against the OS', () => {
    it('resolves "system" to light when the OS does not prefer dark', () => {
      const { result } = renderHook(() => useTheme());

      expect(result.current.system).toBe('light');
      expect(result.current.theme).toBe('light');
    });

    it('resolves "system" to dark when the OS prefers dark', () => {
      stubSystemScheme('dark');

      const { result } = renderHook(() => useTheme());

      expect(result.current.system).toBe('dark');
      expect(result.current.theme).toBe('dark');
    });

    it('falls back to the OS palette when the stored theme no longer exists', () => {
      stubSystemScheme('dark');
      storePreference('retired-theme');

      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('dark');
    });

    it('reports light when the browser cannot report the OS setting', () => {
      // `matchMedia` is absent in some embedded webviews.
      (window as { matchMedia?: unknown }).matchMedia = undefined;

      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('light');
    });
  });

  describe('setPreference', () => {
    it('applies the chosen theme at once', () => {
      const { result } = renderHook(() => useTheme());

      act(() => result.current.setPreference('rose'));

      expect(result.current.preference).toBe('rose');
      expect(result.current.theme).toBe('rose');
    });

    it('persists the chosen theme', () => {
      const { result } = renderHook(() => useTheme());

      act(() => result.current.setPreference('rose'));

      expect(storedPreference()).toBe('rose');
    });

    it('hands the choice back to the OS when set to "system"', () => {
      stubSystemScheme('dark');
      storePreference('rose');
      const { result } = renderHook(() => useTheme());

      act(() => result.current.setPreference('system'));

      expect(result.current.theme).toBe('dark');
    });
  });

  describe('the data-theme attribute', () => {
    it('holds the chosen theme', () => {
      const { result } = renderHook(() => useTheme());

      act(() => result.current.setPreference('ocean'));

      // The `data-theme` block's variables outrank the prefers-color-scheme query.
      expect(document.documentElement).toHaveAttribute('data-theme', 'ocean');
    });

    it('holds the resolved palette, never the literal "system"', () => {
      stubSystemScheme('dark');

      renderHook(() => useTheme());

      expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    });
  });

  describe('the favicon', () => {
    it('is an inline SVG in the theme’s background and accent colours', () => {
      const { result } = renderHook(() => useTheme());

      act(() => result.current.setPreference('forest'));

      const { bg, accent } = themeById('forest');
      expect(faviconLink()).toHaveAttribute('type', 'image/svg+xml');
      expect(faviconLink()!.href.startsWith('data:image/svg+xml,')).toBe(true);
      expect(faviconSvg()).toContain(bg);
      expect(faviconSvg()).toContain(accent);
    });

    it('reuses the existing icon link instead of appending another', () => {
      const existingLink = document.createElement('link');
      existingLink.rel = 'icon';
      existingLink.href = 'old.ico';
      document.head.appendChild(existingLink);

      const { result } = renderHook(() => useTheme());
      act(() => result.current.setPreference('rose'));

      expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
      expect(existingLink.href).not.toBe('old.ico');
    });

    it('is redrawn when the theme changes', () => {
      const { result } = renderHook(() => useTheme());
      act(() => result.current.setPreference('rose'));
      const roseFavicon = faviconLink()!.href;

      act(() => result.current.setPreference('ocean'));

      expect(faviconLink()!.href).not.toBe(roseFavicon);
    });
  });

  describe('when the OS colour scheme changes while running', () => {
    it('switches the theme if the preference is "system"', () => {
      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('light');

      // A scheduled light/dark switch, with no reload.
      switchSystemSchemeTo('dark');

      expect(result.current.system).toBe('dark');
      expect(result.current.theme).toBe('dark');
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    });

    it('leaves a pinned theme in place', () => {
      const { result } = renderHook(() => useTheme());
      act(() => result.current.setPreference('rose'));

      switchSystemSchemeTo('dark');

      expect(result.current.theme).toBe('rose');
    });

    it('keeps reporting the OS palette even while a theme is pinned', () => {
      const { result } = renderHook(() => useTheme());
      act(() => result.current.setPreference('rose'));

      switchSystemSchemeTo('dark');

      // Still tracked, so the "Follow system" option can be labelled correctly.
      expect(result.current.system).toBe('dark');
    });

    it('stops listening once unmounted', () => {
      const { unmount } = renderHook(() => useTheme());
      expect(systemSchemeListeners).toHaveLength(1);

      unmount();

      expect(systemSchemeListeners).toHaveLength(0);
    });
  });
});
