import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RemindersWidget from './RemindersWidget';

// With no VITE_GOOGLE_CLIENT_ID configured the widget is purely local:
// no "Connect Calendar" button, and the setup hint is shown instead.
describe('RemindersWidget (local, calendar not configured)', () => {
  it('shows the empty state and the calendar setup hint', () => {
    render(<RemindersWidget />);
    expect(screen.getByText(/Nothing scheduled/i)).toBeInTheDocument();
    expect(screen.getByText(/VITE_GOOGLE_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Calendar/i })).not.toBeInTheDocument();
  });

  it('adds a reminder and persists it', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);

    await user.type(screen.getByPlaceholderText('Remind me to…'), 'Call the bank{Enter}');

    expect(screen.getByText('Call the bank')).toBeInTheDocument();
    expect(localStorage.getItem('reminders')).toContain('Call the bank');
  });

  it('toggles completion without deleting the reminder', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);
    await user.type(screen.getByPlaceholderText('Remind me to…'), 'Water plants{Enter}');

    const item = screen.getByText('Water plants').closest('li')!;
    await user.click(within(item).getByRole('checkbox'));

    expect(screen.getByText('Water plants').closest('li')).toHaveClass('is-done');
  });

  it('removes a reminder', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);
    await user.type(screen.getByPlaceholderText('Remind me to…'), 'Old task{Enter}');

    await user.click(screen.getByTitle('Delete'));

    expect(screen.queryByText('Old task')).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing scheduled/i)).toBeInTheDocument();
  });

  it('flags a due date that is in the past as overdue', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);

    await user.type(screen.getByPlaceholderText('Remind me to…'), 'Past due');
    // A date well before today's 2026-07-22.
    const dateInput = document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    await user.type(dateInput, '2020-01-01T09:00');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const item = screen.getByText('Past due').closest('li')!;
    expect(item.querySelector('.is-overdue')).not.toBeNull();
  });
});
