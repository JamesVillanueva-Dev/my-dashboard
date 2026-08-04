import { describe, it, expect } from 'vitest';
import {
  DEFAULT_THEME,
  THEMES,
  resolveTheme,
  themeById,
  type ThemeId,
  type ThemePreference,
} from './themes';

describe('THEMES', () => {
  it('has unique ids — the id doubles as the data-theme value', () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes the default', () => {
    expect(THEMES.some((t) => t.id === DEFAULT_THEME)).toBe(true);
  });

  it('lists the light palettes before the dark ones', () => {
    const modes = THEMES.map((t) => t.mode);
    expect(modes.indexOf('dark')).toBeGreaterThan(modes.lastIndexOf('light'));
  });

  it('gives every palette a label and two swatch colours', () => {
    for (const theme of THEMES) {
      expect(theme.label).toBeTruthy();
      expect(['light', 'dark']).toContain(theme.mode);
      // The picker and favicon draw from these, so they must be real hex values.
      expect(theme.bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('themeById', () => {
  it('finds a palette by id', () => {
    expect(themeById('forest')).toMatchObject({ id: 'forest', mode: 'dark' });
  });

  it('falls back to the default for an id that no longer exists', () => {
    // A stored preference can name a theme that was since renamed.
    expect(themeById('retired' as ThemeId).id).toBe(DEFAULT_THEME);
  });
});

describe('resolveTheme', () => {
  it('defers to the OS when the preference is "system"', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
  });

  it('pins a palette the user chose explicitly, whatever the OS says', () => {
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
