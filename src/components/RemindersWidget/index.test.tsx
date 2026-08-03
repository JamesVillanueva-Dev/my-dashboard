import type { ReactElement } from 'react';
import { describe, it, expect } from 'vitest';
import { render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RemindersWidget from './index';
import styles from './styles.module.css';
import { DashboardDataProvider } from '../../hooks/DashboardDataProvider';

/** The task list lives in the shared provider now, so every test supplies one. */
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: DashboardDataProvider });

// With no VITE_GOOGLE_CLIENT_ID configured the widget is purely local:
// no "Connect Calendar" button, and the setup hint is shown instead.
describe('RemindersWidget (local, calendar not configured)', () => {
  it('shows the empty state and the calendar setup hint', () => {
    render(<RemindersWidget />);
    expect(screen.getByText(/No tasks yet/i)).toBeInTheDocument();
    expect(screen.getByText(/VITE_GOOGLE_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Calendar/i })).not.toBeInTheDocument();
  });

  it('accepts an undated task — the case the old To-do widget covered', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);

    await user.type(screen.getByPlaceholderText('Add a task…'), 'Someday thing{Enter}');

    expect(screen.getByText('Someday thing')).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem('reminders')!);
    expect(stored[0]).toMatchObject({ text: 'Someday thing', due: '' });
    // Undated tasks never sync, so they must not be marked dirty.
    expect(stored[0].dirty).toBe(false);
  });

  it('counts unfinished tasks in the header', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);
    await user.type(screen.getByPlaceholderText('Add a task…'), 'One{Enter}');
    await user.type(screen.getByPlaceholderText('Add a task…'), 'Two{Enter}');

    expect(screen.getByText('2 left')).toBeInTheDocument();

    await user.click(within(screen.getByText('One').closest('li')!).getByRole('checkbox'));
    expect(screen.getByText('1 left')).toBeInTheDocument();
  });

  it('adds a reminder and persists it', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);

    await user.type(screen.getByPlaceholderText('Add a task…'), 'Call the bank{Enter}');

    expect(screen.getByText('Call the bank')).toBeInTheDocument();
    expect(localStorage.getItem('reminders')).toContain('Call the bank');
  });

  it('toggles completion without deleting the reminder', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);
    await user.type(screen.getByPlaceholderText('Add a task…'), 'Water plants{Enter}');

    const item = screen.getByText('Water plants').closest('li')!;
    await user.click(within(item).getByRole('checkbox'));

    expect(screen.getByText('Water plants').closest('li')).toHaveClass(styles.isDone);
  });

  it('removes a reminder', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);
    await user.type(screen.getByPlaceholderText('Add a task…'), 'Old task{Enter}');

    await user.click(screen.getByTitle('Delete'));

    expect(screen.queryByText('Old task')).not.toBeInTheDocument();
    expect(screen.getByText(/No tasks yet/i)).toBeInTheDocument();
  });

  it('flags a due date that is in the past as overdue', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);

    await user.type(screen.getByPlaceholderText('Add a task…'), 'Past due');
    // A date well before today's 2026-07-22.
    const dateInput = document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    await user.type(dateInput, '2020-01-01T09:00');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const item = screen.getByText('Past due').closest('li')!;
    expect(item.querySelector(`.${styles.isOverdue}`)).not.toBeNull();
  });
});
