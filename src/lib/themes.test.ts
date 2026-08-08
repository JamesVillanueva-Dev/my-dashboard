import { describe, it, expect } from 'vitest';
import {
  DEFAULT_THEME,
  THEMES,
  resolveTheme,
  themeById,
  type ThemeId,
  type ThemePreference,
} from './themes';

/** Matches the six-digit hex colours the swatch and favicon are drawn from. */
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

describe('THEMES', () => {
  it('gives every palette a unique id', () => {
    const ids = THEMES.map((theme) => theme.id);

    // The id doubles as the `data-theme` attribute value.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes the default palette', () => {
    expect(THEMES.some((theme) => theme.id === DEFAULT_THEME)).toBe(true);
  });

  it('lists the light palettes before the dark ones', () => {
    const modes = THEMES.map((theme) => theme.mode);

    expect(modes.indexOf('dark')).toBeGreaterThan(modes.lastIndexOf('light'));
  });

  it('gives every palette a label and a mode', () => {
    for (const theme of THEMES) {
      expect(theme.label).toBeTruthy();
      expect(['light', 'dark']).toContain(theme.mode);
    }
  });

  it('gives every palette two hex swatch colours', () => {
    for (const theme of THEMES) {
      // The picker and the favicon draw from these, so they must be real hex values.
      expect(theme.bg).toMatch(HEX_COLOUR);
      expect(theme.accent).toMatch(HEX_COLOUR);
    }
  });
});

describe('themeById', () => {
  it('finds a palette by id', () => {
    const theme = themeById('forest');

    expect(theme.id).toBe('forest');
    expect(theme.mode).toBe('dark');
  });

  it('falls back to the default for an id that no longer exists', () => {
    // A stored preference can name a theme that has since been renamed.
    expect(themeById('retired' as ThemeId).id).toBe(DEFAULT_THEME);
  });
});

describe('resolveTheme', () => {
  it('defers to the OS palette when the preference is "system"', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
  });

  it('keeps an explicitly chosen palette whatever the OS says', () => {
    expect(resolveTheme('rose', 'dark')).toBe('rose');
    expect(resolveTheme('ocean', 'light')).toBe('ocean');
  });

  it('resolves every shipped palette to itself', () => {
    for (const theme of THEMES) {
      expect(resolveTheme(theme.id, 'dark')).toBe(theme.id);
    }
  });

  it('falls back to the OS palette for an unrecognised preference', () => {
    // Hand-edited or stale storage degrades rather than leaving the page unstyled.
    expect(resolveTheme('neon' as ThemePreference, 'dark')).toBe('dark');
    expect(resolveTheme('' as ThemePreference, 'light')).toBe('light');
  });
});
