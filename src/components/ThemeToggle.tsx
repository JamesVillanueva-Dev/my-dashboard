import { useEffect } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';

type Theme = 'light' | 'dark';

/**
 * Reads the operating system's colour-scheme preference, used as the initial
 * theme before the user has made an explicit choice.
 *
 * @returns `'dark'` (black & yellow) when the OS prefers dark, otherwise
 *   `'light'` (white & blue, the app default).
 */
function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Builds a favicon (a rounded square with a centred inner square) coloured for
 * the given theme, encoded as an inline `data:` URI.
 *
 * @param theme - The active theme.
 * @returns A data URI suitable for a `<link rel="icon">` href.
 */
function faviconFor(theme: Theme): string {
  const bg = theme === 'dark' ? '#0c0c0d' : '#ffffff';
  const fg = theme === 'dark' ? '#ffd21e' : '#2f6bff';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect x="3" y="3" width="94" height="94" rx="16" fill="${bg}" stroke="${fg}" stroke-width="6"/>` +
    `<rect x="30" y="30" width="40" height="40" rx="6" fill="${fg}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Points the page's favicon link at a fresh, theme-coloured icon. */
function applyFavicon(theme: Theme): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = faviconFor(theme);
}

/**
 * Button that toggles between the white-&-blue ("light") and black-&-yellow
 * ("dark") palettes. The choice persists in localStorage and is applied by
 * setting `data-theme` on the document root, whose CSS variable overrides win
 * over the `prefers-color-scheme` media query.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useLocalStorage<Theme>('theme', systemTheme());

  // Apply the choice to <html data-theme> so the CSS variables switch, and swap
  // the favicon so it tracks the in-app toggle (not just the OS setting).
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    applyFavicon(theme);
  }, [theme]);

  const next: Theme = theme === 'light' ? 'dark' : 'light';

  return (
    <button
      className="pill theme-toggle"
      onClick={() => setTheme(next)}
      title={`Switch to ${next === 'dark' ? 'black & yellow (dark)' : 'white & blue (light)'} theme`}
      aria-label="Toggle color theme"
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
}
