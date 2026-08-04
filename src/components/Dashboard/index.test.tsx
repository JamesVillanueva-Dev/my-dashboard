import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from './index';
import { DEFAULT_LAYOUT } from '../../lib/registry';

describe('Dashboard', () => {
  it('renders every default widget', () => {
    render(<Dashboard />);
    for (const title of ['Tasks', 'Calendar', 'Weather', 'News', 'Notes', 'YouTube']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    }
  });

  it('leaves the opt-in Spotify panel off until it is switched on', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    expect(screen.queryByRole('heading', { level: 2, name: 'Spotify' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Manage widgets' }));
    await user.click(screen.getByRole('checkbox', { name: 'Spotify' }));

    expect(screen.getByRole('heading', { level: 2, name: 'Spotify' })).toBeInTheDocument();
  });

  it('leads with the Today zone, above the widget grid', () => {
    render(<Dashboard />);
    expect(screen.getByRole('heading', { level: 2, name: 'Next up' })).toBeInTheDocument();
    expect(screen.getByLabelText(/one focus is/i)).toBeInTheDocument();
  });

  it('drops retired widget ids from a saved layout instead of crashing', () => {
    // 'todo', 'focus' and 'quicklinks' shipped as panels and no longer are one.
    window.localStorage.setItem(
      'layout',
      JSON.stringify(['todo', 'notes', 'focus', 'weather', 'quicklinks']),
    );
    render(<Dashboard />);

    expect(screen.getByRole('heading', { level: 2, name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Weather' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'To-do' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Quick Links' })).not.toBeInTheDocument();
  });

  it('handles network failure gracefully (weather shows an error, not a crash)', async () => {
    render(<Dashboard />);
    // fetch is stubbed to reject in test setup; the widget should surface a handled error.
    expect(await screen.findByText(/Couldn't load weather/i)).toBeInTheDocument();
  });

  it('gives each widget a reorder handle', () => {
    render(<Dashboard />);
    const grips = screen.getAllByRole('button', { name: /^reorder /i });
    expect(grips).toHaveLength(DEFAULT_LAYOUT.length);
  });

  it('reorders a widget with the arrow keys and announces the move', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const headingsBefore = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);

    // Move the first panel down one place using only the keyboard.
    const grips = screen.getAllByRole('button', { name: /^reorder /i });
    grips[0].focus();
    await user.keyboard('{ArrowDown}');

    const headingsAfter = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headingsAfter).not.toEqual(headingsBefore);
    expect(screen.getByText(/moved to position 2 of/i)).toBeInTheDocument();
  });

  it('removes a widget via its × button', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    expect(screen.getByRole('heading', { level: 2, name: 'Notes' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove notes widget/i }));

    expect(screen.queryByRole('heading', { level: 2, name: 'Notes' })).not.toBeInTheDocument();
  });

  it('widens a panel with the arrow keys and persists the new width', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Weather ships one column wide.
    const handle = screen.getByRole('button', { name: /^resize weather/i });
    expect(handle).toHaveAccessibleName(/1 column wide/i);

    handle.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');

    expect(screen.getByRole('button', { name: /^resize weather/i })).toHaveAccessibleName(
      /3 columns wide/i,
    );
    expect(JSON.parse(localStorage.getItem('widget.sizes')!)).toMatchObject({
      weather: { cols: 3, height: null },
    });
    expect(screen.getByText(/weather resized to 3 columns wide/i)).toBeInTheDocument();
  });

  it('will not narrow a panel past a single column', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    screen.getByRole('button', { name: /^resize weather/i }).focus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');

    expect(screen.getByRole('button', { name: /^resize weather/i })).toHaveAccessibleName(
      /1 column wide/i,
    );
  });

  it('pins a height with the arrow keys, then fits it back to the content', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const handle = screen.getByRole('button', { name: /^resize weather/i });
    expect(handle).toHaveAccessibleName(/height fits the content/i);

    handle.focus();
    await user.keyboard('{ArrowDown}');
    // jsdom lays nothing out, so the panel measures 0 tall and the first press
    // lands on the floor rather than one step above it.
    expect(screen.getByRole('button', { name: /^resize weather/i })).toHaveAccessibleName(
      /120 pixels tall/i,
    );

    // Enter unpins, the keyboard equivalent of double-clicking the handle.
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: /^resize weather/i })).toHaveAccessibleName(
      /height fits the content/i,
    );
  });

  it('reads back the named widths saved before panels were freely resizable', () => {
    localStorage.setItem('widget.sizes', JSON.stringify({ weather: 'wide' }));
    render(<Dashboard />);

    expect(screen.getByRole('button', { name: /^resize weather/i })).toHaveAccessibleName(
      /3 columns wide/i,
    );
  });

  it('restores default sizes on reset', async () => {
    localStorage.setItem('widget.sizes', JSON.stringify({ weather: { cols: 4, height: 400 } }));
    const user = userEvent.setup();
    render(<Dashboard />);

    expect(screen.getByRole('button', { name: /^resize weather/i })).toHaveAccessibleName(
      /4 columns wide, 400 pixels tall/i,
    );

    await user.click(screen.getByRole('button', { name: /manage widgets/i }));
    await user.click(screen.getByRole('button', { name: /reset layout and sizes/i }));

    expect(screen.getByRole('button', { name: /^resize weather/i })).toHaveAccessibleName(
      /1 column wide, height fits the content/i,
    );
  });

  it('turns the daily focus off and on from the widget menu', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    expect(screen.getByLabelText(/one focus is/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /manage widgets/i }));
    await user.click(within(screen.getByRole('menu')).getByLabelText(/daily focus/i));

    expect(screen.queryByLabelText(/one focus is/i)).not.toBeInTheDocument();
    expect(localStorage.getItem('today.showFocus')).toBe('false');

    await user.click(within(screen.getByRole('menu')).getByLabelText(/daily focus/i));
    expect(screen.getByLabelText(/one focus is/i)).toBeInTheDocument();
  });

  it('opens the Privacy Policy and Terms of Service from the footer', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    await user.click(screen.getByRole('button', { name: 'Privacy Policy' }));
    const dialog = screen.getByRole('dialog', { name: 'Privacy Policy' });
    expect(within(dialog).getByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();

    // Close it, then open the Terms.
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Terms of Service' }));
    expect(screen.getByRole('dialog', { name: 'Terms of Service' })).toBeInTheDocument();
  });

  it('toggles widgets on and off through the widget menu', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    await user.click(screen.getByRole('button', { name: /manage widgets/i }));
    const menu = screen.getByRole('menu');

    // Disable "Notes" from the menu.
    await user.click(within(menu).getByLabelText(/Notes/));
    expect(screen.queryByRole('heading', { level: 2, name: 'Notes' })).not.toBeInTheDocument();

    // Re-enable it.
    await user.click(within(menu).getByLabelText(/Notes/));
    expect(screen.getByRole('heading', { level: 2, name: 'Notes' })).toBeInTheDocument();
  });
});
