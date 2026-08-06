import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

/** The global stub from `src/test/setup.ts`, which reports no mouse. */
const realMatchMedia = window.matchMedia;

/**
 * Reports a device with a mouse, so the background section is offered. The
 * default stub answers `false` to everything, which is a touch device.
 */
function stubMouse() {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('pointer: fine'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = realMatchMedia;
  document.documentElement.removeAttribute('data-aura');
});

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

  describe('the cursor aura', () => {
    it('is not offered on a device with no pointer to follow', async () => {
      await openMenu();

      expect(screen.queryByRole('checkbox', { name: /aura/i })).not.toBeInTheDocument();
      expect(screen.queryByText('Background')).not.toBeInTheDocument();
    });

    it('is offered, and off, on a device with a mouse', async () => {
      stubMouse();

      await openMenu();

      expect(screen.getByRole('checkbox', { name: /aura follows the cursor/i })).not.toBeChecked();
    });

    it('starts following when switched on, and persists the choice', async () => {
      stubMouse();
      const user = await openMenu();

      await user.click(screen.getByRole('checkbox', { name: /aura/i }));

      expect(screen.getByRole('checkbox', { name: /aura/i })).toBeChecked();
      expect(document.documentElement).toHaveAttribute('data-aura', 'pointer');
      expect(localStorage.getItem('aura.follow')).toBe(JSON.stringify(true));
    });

    it('gives the corner position back when switched off', async () => {
      stubMouse();
      localStorage.setItem('aura.follow', JSON.stringify(true));
      const user = await openMenu();

      await user.click(screen.getByRole('checkbox', { name: /aura/i }));

      await waitFor(() => expect(document.documentElement).not.toHaveAttribute('data-aura'));
      expect(localStorage.getItem('aura.follow')).toBe(JSON.stringify(false));
    });

    it('restores a choice stored by a previous visit', async () => {
      stubMouse();
      localStorage.setItem('aura.follow', JSON.stringify(true));

      await openMenu();

      expect(screen.getByRole('checkbox', { name: /aura/i })).toBeChecked();
      expect(document.documentElement).toHaveAttribute('data-aura', 'pointer');
    });

    it('leaves the palette picker alone', async () => {
      stubMouse();
      const user = await openMenu();

      await user.click(screen.getByRole('checkbox', { name: /aura/i }));

      expect(screen.getAllByRole('radio')).toHaveLength(THEMES.length + 1);
      expect(screen.getByRole('radio', { name: /follow system/i })).toBeChecked();
    });
  });
});
