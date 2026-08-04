/**
 * The dashboard's colour schemes.
 *
 * Each theme is one complete palette with its own inherent lightness — "Forest"
 * is always dark, "Rose" is always light — rather than an accent colour layered
 * on top of a separate light/dark switch. That keeps the mechanism the app
 * started with: the active theme's id goes on `<html data-theme>`, and the
 * matching `:root[data-theme='…']` block in `src/styles.css` swaps every token.
 *
 * The palettes themselves live in that stylesheet. What lives here is the
 * metadata the UI needs: the display name, whether the palette reads as light or
 * dark, and the two colours used to draw the theme's swatch in the settings menu
 * and the favicon. Those two are deliberately duplicated from the stylesheet —
 * CSS custom properties only resolve for the *active* theme, so a picker showing
 * every theme at once cannot read them.
 *
 * Adding a theme means adding an entry here and a `:root[data-theme='<id>']`
 * block with the same id in `src/styles.css`.
 */

/** Identifier of a concrete palette; doubles as the `data-theme` attribute value. */
export type ThemeId =
  | 'light'
  | 'dark'
  | 'midnight'
  | 'forest'
  | 'ocean'
  | 'rose'
  | 'solarized';

/**
 * What the user picked. `'system'` defers to the OS `prefers-color-scheme`
 * setting and resolves to `'light'` or `'dark'`; anything else pins one palette.
 */
export type ThemePreference = ThemeId | 'system';

/** A selectable colour scheme. */
export interface Theme {
  /** Value written to `<html data-theme>`. */
  id: ThemeId;
  /** Name shown in the settings menu. */
  label: string;
  /** Whether the palette reads as light or dark, shown as a hint beside the label. */
  mode: 'light' | 'dark';
  /** Page background, for the swatch and favicon. Mirrors `--bg`. */
  bg: string;
  /** Accent colour, for the swatch and favicon. Mirrors `--accent`. */
  accent: string;
}

/** Every theme, in the order the settings menu lists them (light first). */
export const THEMES: readonly Theme[] = [
  { id: 'light', label: 'White & blue', mode: 'light', bg: '#f5f7fb', accent: '#2f6bff' },
  { id: 'rose', label: 'Rose', mode: 'light', bg: '#fdf6f7', accent: '#d6336c' },
  { id: 'solarized', label: 'Solarized', mode: 'light', bg: '#fdf6e3', accent: '#268bd2' },
  { id: 'dark', label: 'Black & yellow', mode: 'dark', bg: '#0c0c0d', accent: '#ffd21e' },
  { id: 'midnight', label: 'Purple & blue', mode: 'dark', bg: '#0d0b16', accent: '#8b7cff' },
  { id: 'forest', label: 'Forest', mode: 'dark', bg: '#0a1310', accent: '#4ade80' },
  { id: 'ocean', label: 'Ocean', mode: 'dark', bg: '#071018', accent: '#38bdf8' },
];

/** The palette used when a stored preference is missing or unrecognised. */
export const DEFAULT_THEME: ThemeId = 'light';

/** Looks up a theme's metadata, falling back to {@link DEFAULT_THEME}. */
export function themeById(id: ThemeId): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!;
}

/**
 * Resolves a stored preference to the palette that should actually be applied.
 *
 * Unrecognised values fall back to the system palette rather than throwing, so a
 * hand-edited or stale `localStorage` entry — say a theme that has since been
 * renamed — degrades to a sensible default instead of an unstyled page.
 *
 * @param preference - The user's stored choice.
 * @param system - The palette the OS setting currently maps to.
 * @returns The id to write to `data-theme`.
 */
export function resolveTheme(preference: ThemePreference, system: ThemeId): ThemeId {
  if (preference === 'system') return system;
  return THEMES.some((t) => t.id === preference) ? preference : system;
}
