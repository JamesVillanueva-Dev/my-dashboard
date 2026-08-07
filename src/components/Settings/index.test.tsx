import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from './index';
import styles from './styles.module.css';
import { DashboardDataProvider } from '../../hooks/DashboardDataProvider';
import { THEMES } from '../../lib/themes';

/**
 * Renders the menu with the shared data provider behind it, which owns the
 * notification setting — see `useDashboardData`.
 */
function renderSettings() {
  return render(
    <DashboardDataProvider>
      <Settings />
    </DashboardDataProvider>,
  );
}

/** Opens the settings dropdown and returns the user-event session. */
async function openMenu() {
  const user = userEvent.setup();
  renderSettings();
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

/** The stub's answer to `Notification.permission`. */
let granted: NotificationPermission = 'default';

/**
 * Installs the Notification API, which jsdom does not provide — so by default
 * every test above sees a browser that cannot notify, and the section is absent.
 */
function stubNotification() {
  vi.stubGlobal(
    'Notification',
    class {
      static get permission() {
        return granted;
      }
      static requestPermission = vi.fn(() => {
        granted = 'granted';
        return Promise.resolve(granted);
      });
      close = vi.fn();
    },
  );
}

beforeEach(() => {
  granted = 'default';
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
  document.documentElement.removeAttribute('data-aura');
  vi.unstubAllGlobals();
});

describe('Settings', () => {
  it('follows the system scheme until the user picks a palette', () => {
    renderSettings();
    // matchMedia is stubbed to report "not dark", so system resolves to light.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('keeps the menu closed until the trigger is clicked', async () => {
    const user = userEvent.setup();
    renderSettings();
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
    renderSettings();
    expect(document.documentElement.getAttribute('data-theme')).toBe('rose');
  });

  it('falls back to the system scheme when the stored value is unusable', () => {
    localStorage.setItem('theme', JSON.stringify('chartreuse'));
    renderSettings();
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

  describe('due notices', () => {
    it('is not offered where the browser cannot notify at all', async () => {
      await openMenu();

      expect(screen.queryByRole('checkbox', { name: /task is due/i })).not.toBeInTheDocument();
      expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
    });

    it('is offered, and off, where it is supported', async () => {
      stubNotification();

      await openMenu();

      expect(screen.getByRole('checkbox', { name: /remind me when a task is due/i })).not.toBeChecked();
    });

    it('asks the browser for permission when switched on, and persists the choice', async () => {
      stubNotification();
      const user = await openMenu();

      await user.click(screen.getByRole('checkbox', { name: /task is due/i }));

      await waitFor(() =>
        expect(screen.getByRole('checkbox', { name: /task is due/i })).toBeChecked(),
      );
      expect(localStorage.getItem('notify.tasks')).toBe(JSON.stringify(true));
    });

    it('says so, and refuses to switch on, once refused at the browser level', async () => {
      granted = 'denied';
      stubNotification();

      const user = await openMenu();
      const box = screen.getByRole('checkbox', { name: /task is due/i });

      expect(box).toBeDisabled();
      expect(screen.getByText('Blocked')).toBeInTheDocument();
      expect(box.closest('label')).toHaveClass(styles.isBlocked);

      await user.click(box);
      expect(box).not.toBeChecked();
      expect(localStorage.getItem('notify.tasks')).not.toBe(JSON.stringify(true));
    });

    it('leaves the palette picker alone', async () => {
      stubNotification();
      const user = await openMenu();

      await user.click(screen.getByRole('checkbox', { name: /task is due/i }));

      expect(screen.getAllByRole('radio')).toHaveLength(THEMES.length + 1);
      expect(screen.getByRole('radio', { name: /follow system/i })).toBeChecked();
    });
  });
});
