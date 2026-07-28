import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from './index';
import { DEFAULT_LAYOUT } from '../../lib/registry';

describe('Dashboard', () => {
  it('renders every default widget', () => {
    render(<Dashboard />);
    for (const title of [
      'Focus of the Day',
      'Weather',
      'Reminders',
      'To-do',
      'News',
      'Notes',
      'Quick Links',
      'Spotify',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    }
  });

  it('handles network failure gracefully (weather shows an error, not a crash)', async () => {
    render(<Dashboard />);
    // fetch is stubbed to reject in test setup; the widget should surface a handled error.
    expect(await screen.findByText(/Couldn't load weather/i)).toBeInTheDocument();
  });

  it('gives each widget a drag handle so it can be reordered', () => {
    render(<Dashboard />);
    const grips = screen.getAllByRole('button', { name: /drag to reorder/i });
    expect(grips).toHaveLength(DEFAULT_LAYOUT.length);
  });

  it('removes a widget via its × button', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    expect(screen.getByRole('heading', { level: 2, name: 'Notes' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove notes widget/i }));

    expect(screen.queryByRole('heading', { level: 2, name: 'Notes' })).not.toBeInTheDocument();
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

    // Disable "To-do" from the menu.
    await user.click(within(menu).getByLabelText(/To-do/));
    expect(screen.queryByRole('heading', { level: 2, name: 'To-do' })).not.toBeInTheDocument();

    // Re-enable it.
    await user.click(within(menu).getByLabelText(/To-do/));
    expect(screen.getByRole('heading', { level: 2, name: 'To-do' })).toBeInTheDocument();
  });
});
