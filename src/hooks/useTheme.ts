import { useEffect, useState } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { DEFAULT_THEME, resolveTheme, themeById } from '../lib/themes';
import type { ThemeId, ThemePreference } from '../lib/themes';

/**
 * The palette the operating system's colour-scheme setting maps to.
 *
 * @returns `'dark'` when the OS prefers dark, otherwise {@link DEFAULT_THEME}.
 */
function systemTheme(): ThemeId {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : DEFAULT_THEME;
}

/**
 * Builds a favicon (a rounded square with a centred inner square) in the given
 * theme's colours, encoded as an inline `data:` URI.
 *
 * @param theme - The active theme.
 * @returns A data URI suitable for a `<link rel="icon">` href.
 */
function faviconFor(theme: ThemeId): string {
  const { bg, accent } = themeById(theme);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect x="3" y="3" width="94" height="94" rx="16" fill="${bg}" stroke="${accent}" stroke-width="6"/>` +
    `<rect x="30" y="30" width="40" height="40" rx="6" fill="${accent}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Points the page's favicon link at a fresh, theme-coloured icon. */
function applyFavicon(theme: ThemeId): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = faviconFor(theme);
}

/** What {@link useTheme} hands back. */
interface UseTheme {
  /** The stored choice, which may be `'system'`. */
  preference: ThemePreference;
  /** Record a new choice; persists and applies immediately. */
  setPreference: (preference: ThemePreference) => void;
  /** The palette actually in effect, with `'system'` already resolved. */
  theme: ThemeId;
  /** The palette the OS currently maps to, for labelling the "Follow system" option. */
  system: ThemeId;
}

/**
 * Owns the colour scheme: reads the persisted preference, resolves `'system'`
 * against the OS setting, and applies the result by setting `data-theme` on the
 * document root — whose CSS-variable overrides win over the
 * `prefers-color-scheme` media query by specificity.
 *
 * While the preference is `'system'` the hook tracks OS changes live, so the
 * dashboard follows a scheduled light/dark switch without a reload.
 *
 * Values persisted by the earlier light/dark toggle are still valid preferences,
 * so an existing choice survives the move to named themes untouched.
 *
 * @returns See {@link UseTheme}.
 */
export function useTheme(): UseTheme {
  const [preference, setPreference] = useLocalStorage<ThemePreference>('theme', 'system');
  const [system, setSystem] = useState<ThemeId>(systemTheme);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query?.addEventListener) return;
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? 'dark' : DEFAULT_THEME);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const theme = resolveTheme(preference, system);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    applyFavicon(theme);
  }, [theme]);

  return { preference, setPreference, theme, system };
}
