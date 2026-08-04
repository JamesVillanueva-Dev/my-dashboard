import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from './index';
import { THEMES } from '../../lib/themes';

/** Opens the settings dropdown and returns the user-event session. */
async function openMenu() {
  const user = userEvent.setup();
  render(<Settings />);
  await user.click(screen.getByRole('button', { name: /settings/i }));
  return user;
}

describe('Settings', () => {
  it('follows the system scheme until the user picks a palette', () => {
    render(<Settings />);
    // matchMedia is stubbed to report "not dark", so system resolves to light.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('keeps the menu closed until the trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /settings/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('offers every theme plus a "follow system" option', async () => {
    await openMenu();
    for (const theme of THEMES) {
      expect(screen.getByRole('radio', { name: new RegExp(theme.label, 'i') })).toBeInTheDocument();
    }
    expect(screen.getByRole('radio', { name: /follow system/i })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(THEMES.length + 1);
  });

  it('applies a chosen palette to the document root and persists it', async () => {
    const user = await openMenu();
    await user.click(screen.getByRole('radio', { name: /forest/i }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('forest');
    expect(localStorage.getItem('theme')).toBe(JSON.stringify('forest'));
    expect(screen.getByRole('radio', { name: /forest/i })).toBeChecked();
  });

  it('switches between palettes', async () => {
    const user = await openMenu();
    await user.click(screen.getByRole('radio', { name: /solarized/i }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('solarized');

    await user.click(screen.getByRole('radio', { name: /purple & blue/i }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight');
    expect(screen.getByRole('radio', { name: /solarized/i })).not.toBeChecked();
  });

  it('returns to the system scheme when "follow system" is reselected', async () => {
    const user = await openMenu();
    await user.click(screen.getByRole('radio', { name: /ocean/i }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('ocean');

    await user.click(screen.getByRole('radio', { name: /follow system/i }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBe(JSON.stringify('system'));
  });

  it('restores a palette stored by a previous visit', () => {
    localStorage.setItem('theme', JSON.stringify('rose'));
    render(<Settings />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('rose');
  });

  it('falls back to the system scheme when the stored value is unusable', () => {
    localStorage.setItem('theme', JSON.stringify('chartreuse'));
    render(<Settings />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('recolours the favicon to match the active theme', async () => {
    const user = await openMenu();
    await user.click(screen.getByRole('radio', { name: /black & yellow/i }));

    const href = document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href ?? '';
    expect(decodeURIComponent(href)).toContain('#ffd21e');
  });

  it('closes on Escape', async () => {
    const user = await openMenu();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on an outside click', async () => {
    const user = await openMenu();
    await user.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
