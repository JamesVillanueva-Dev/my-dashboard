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
async function openSettingsMenu() {
  const user = userEvent.setup();
  renderSettings();
  await user.click(screen.getByRole('button', { name: /settings/i }));
  return user;
}

/** The palette currently written to the document root. */
const activeTheme = () => document.documentElement.getAttribute('data-theme');

/** One of the palette radios. */
const themeRadio = (name: RegExp) => screen.getByRole('radio', { name });

/** The cursor-aura checkbox. */
const auraToggle = () => screen.getByRole('checkbox', { name: /aura/i });

/** The due-notices checkbox. */
const noticesToggle = () => screen.getByRole('checkbox', { name: /task is due/i });

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
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

/** The stub's answer to `Notification.permission`. */
let currentPermission: NotificationPermission = 'default';

/**
 * Installs the Notification API, which jsdom does not provide — so by default
 * every test above sees a browser that cannot notify, and the section is absent.
 */
function stubNotification() {
  vi.stubGlobal(
    'Notification',
    class {
      static get permission() {
        return currentPermission;
      }
      static requestPermission = vi.fn(() => {
        currentPermission = 'granted';
        return Promise.resolve(currentPermission);
      });
      close = vi.fn();
    },
  );
}

beforeEach(() => {
  currentPermission = 'default';
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
  document.documentElement.removeAttribute('data-aura');
  vi.unstubAllGlobals();
});

describe('Settings menu', () => {
  it('keeps the menu closed until the trigger is clicked', async () => {
    const user = userEvent.setup();
    renderSettings();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /settings/i }));

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = await openSettingsMenu();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on an outside click', async () => {
    const user = await openSettingsMenu();

    await user.click(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('Settings theme picker', () => {
  it('follows the system scheme until the user picks a palette', () => {
    renderSettings();

    // matchMedia is stubbed to report "not dark", so system resolves to light.
    expect(activeTheme()).toBe('light');
  });

  it('offers every theme plus a "follow system" option', async () => {
    await openSettingsMenu();

    for (const theme of THEMES) {
      expect(themeRadio(new RegExp(theme.label, 'i'))).toBeInTheDocument();
    }
    expect(themeRadio(/follow system/i)).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(THEMES.length + 1);
  });

  it('applies a chosen palette to the document root', async () => {
    const user = await openSettingsMenu();

    await user.click(themeRadio(/forest/i));

    expect(activeTheme()).toBe('forest');
    expect(themeRadio(/forest/i)).toBeChecked();
  });

  it('persists the chosen palette', async () => {
    const user = await openSettingsMenu();

    await user.click(themeRadio(/forest/i));

    expect(localStorage.getItem('theme')).toBe(JSON.stringify('forest'));
  });

  it('switches between palettes', async () => {
    const user = await openSettingsMenu();
    await user.click(themeRadio(/solarized/i));
    expect(activeTheme()).toBe('solarized');

    await user.click(themeRadio(/purple & blue/i));

    expect(activeTheme()).toBe('midnight');
    expect(themeRadio(/solarized/i)).not.toBeChecked();
  });

  it('returns to the system scheme when "follow system" is reselected', async () => {
    const user = await openSettingsMenu();
    await user.click(themeRadio(/ocean/i));
    expect(activeTheme()).toBe('ocean');

    await user.click(themeRadio(/follow system/i));

    expect(activeTheme()).toBe('light');
    expect(localStorage.getItem('theme')).toBe(JSON.stringify('system'));
  });

  it('restores a palette stored by a previous visit', () => {
    localStorage.setItem('theme', JSON.stringify('rose'));

    renderSettings();

    expect(activeTheme()).toBe('rose');
  });

  it('falls back to the system scheme when the stored value is unusable', () => {
    localStorage.setItem('theme', JSON.stringify('chartreuse'));

    renderSettings();

    expect(activeTheme()).toBe('light');
  });

  it('recolours the favicon to match the active theme', async () => {
    const user = await openSettingsMenu();

    await user.click(themeRadio(/black & yellow/i));

    const href = document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href ?? '';
    expect(decodeURIComponent(href)).toContain('#ffd21e');
  });
});

describe('Settings cursor aura', () => {
  it('is not offered on a device with no pointer to follow', async () => {
    await openSettingsMenu();

    expect(screen.queryByRole('checkbox', { name: /aura/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Background')).not.toBeInTheDocument();
  });

  it('is offered, and off, on a device with a mouse', async () => {
    stubMouse();

    await openSettingsMenu();

    expect(screen.getByRole('checkbox', { name: /aura follows the cursor/i })).not.toBeChecked();
  });

  it('starts following when switched on', async () => {
    stubMouse();
    const user = await openSettingsMenu();

    await user.click(auraToggle());

    expect(auraToggle()).toBeChecked();
    expect(document.documentElement).toHaveAttribute('data-aura', 'pointer');
  });

  it('persists that choice', async () => {
    stubMouse();
    const user = await openSettingsMenu();

    await user.click(auraToggle());

    expect(localStorage.getItem('aura.follow')).toBe(JSON.stringify(true));
  });

  it('gives the corner position back when switched off', async () => {
    stubMouse();
    localStorage.setItem('aura.follow', JSON.stringify(true));
    const user = await openSettingsMenu();

    await user.click(auraToggle());

    await waitFor(() => expect(document.documentElement).not.toHaveAttribute('data-aura'));
    expect(localStorage.getItem('aura.follow')).toBe(JSON.stringify(false));
  });

  it('restores a choice stored by a previous visit', async () => {
    stubMouse();
    localStorage.setItem('aura.follow', JSON.stringify(true));

    await openSettingsMenu();

    expect(auraToggle()).toBeChecked();
    expect(document.documentElement).toHaveAttribute('data-aura', 'pointer');
  });

  it('leaves the palette picker alone', async () => {
    stubMouse();
    const user = await openSettingsMenu();

    await user.click(auraToggle());

    expect(screen.getAllByRole('radio')).toHaveLength(THEMES.length + 1);
    expect(themeRadio(/follow system/i)).toBeChecked();
  });
});

describe('Settings due notices', () => {
  it('are not offered where the browser cannot notify at all', async () => {
    await openSettingsMenu();

    expect(screen.queryByRole('checkbox', { name: /task is due/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });

  it('are offered, and off, where they are supported', async () => {
    stubNotification();

    await openSettingsMenu();

    expect(
      screen.getByRole('checkbox', { name: /remind me when a task is due/i }),
    ).not.toBeChecked();
  });

  it('ask the browser for permission when switched on', async () => {
    stubNotification();
    const user = await openSettingsMenu();

    await user.click(noticesToggle());

    await waitFor(() => expect(noticesToggle()).toBeChecked());
    expect(localStorage.getItem('notify.tasks')).toBe(JSON.stringify(true));
  });

  it('read as blocked once refused at the browser level', async () => {
    currentPermission = 'denied';
    stubNotification();

    await openSettingsMenu();

    expect(noticesToggle()).toBeDisabled();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(noticesToggle().closest('label')).toHaveClass(styles.isBlocked);
  });

  it('refuse to switch on once blocked', async () => {
    currentPermission = 'denied';
    stubNotification();
    const user = await openSettingsMenu();

    await user.click(noticesToggle());

    expect(noticesToggle()).not.toBeChecked();
    expect(localStorage.getItem('notify.tasks')).not.toBe(JSON.stringify(true));
  });

  it('leave the palette picker alone', async () => {
    stubNotification();
    const user = await openSettingsMenu();

    await user.click(noticesToggle());

    expect(screen.getAllByRole('radio')).toHaveLength(THEMES.length + 1);
    expect(themeRadio(/follow system/i)).toBeChecked();
  });
});
