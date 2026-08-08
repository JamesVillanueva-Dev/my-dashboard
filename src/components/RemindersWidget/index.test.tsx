import type { ReactElement } from 'react';
import { describe, it, expect } from 'vitest';
import { render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RemindersWidget from './index';
import styles from './styles.module.css';
import { DashboardDataProvider } from '../../hooks/DashboardDataProvider';

/** The task list lives in the shared provider now, so every test supplies one. */
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: DashboardDataProvider });

/** Types a task into the composer and submits it with Enter. */
async function addTask(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByPlaceholderText('Add a task…'), `${text}{Enter}`);
}

/** The list row a task's text sits in. */
const rowFor = (text: string) => screen.getByText(text).closest('li')!;

/** The task list as it was persisted. */
const storedTasks = () => JSON.parse(localStorage.getItem('reminders')!);

// With no VITE_GOOGLE_CLIENT_ID configured the widget is purely local:
// no "Connect Calendar" button, and the setup hint is shown instead.
describe('RemindersWidget with the calendar not configured', () => {
  it('shows the empty state', () => {
    render(<RemindersWidget />);

    expect(screen.getByText(/No tasks yet/i)).toBeInTheDocument();
  });

  it('shows the calendar setup hint instead of a Connect button', () => {
    render(<RemindersWidget />);

    expect(screen.getByText(/VITE_GOOGLE_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Calendar/i })).not.toBeInTheDocument();
  });
});

describe('RemindersWidget adding a task', () => {
  it('shows the new task and persists it', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);

    await addTask(user, 'Call the bank');

    expect(screen.getByText('Call the bank')).toBeInTheDocument();
    expect(localStorage.getItem('reminders')).toContain('Call the bank');
  });

  it('accepts an undated task — the case the old To-do widget covered', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);

    await addTask(user, 'Someday thing');

    expect(storedTasks()[0]).toMatchObject({ text: 'Someday thing', due: '' });
  });

  it('does not mark an undated task dirty, since it can never sync', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);

    await addTask(user, 'Someday thing');

    expect(storedTasks()[0].dirty).toBe(false);
  });

  it('flags a due date in the past as overdue', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);

    await user.type(screen.getByPlaceholderText('Add a task…'), 'Past due');
    // A date well before today's 2026-07-22.
    const dueDateField = document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    await user.type(dueDateField, '2020-01-01T09:00');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(rowFor('Past due').querySelector(`.${styles.isOverdue}`)).not.toBeNull();
  });
});

describe('RemindersWidget working through the list', () => {
  it('counts unfinished tasks in the header', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);

    await addTask(user, 'One');
    await addTask(user, 'Two');

    expect(screen.getByText('2 left')).toBeInTheDocument();
  });

  it('drops a completed task out of that count', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);
    await addTask(user, 'One');
    await addTask(user, 'Two');

    await user.click(within(rowFor('One')).getByRole('checkbox'));

    expect(screen.getByText('1 left')).toBeInTheDocument();
  });

  it('marks a task done without deleting it', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);
    await addTask(user, 'Water plants');

    await user.click(within(rowFor('Water plants')).getByRole('checkbox'));

    expect(rowFor('Water plants')).toHaveClass(styles.isDone);
  });

  it('removes a task', async () => {
    const user = userEvent.setup();
    render(<RemindersWidget />);
    await addTask(user, 'Old task');

    await user.click(screen.getByTitle('Delete'));

    expect(screen.queryByText('Old task')).not.toBeInTheDocument();
    expect(screen.getByText(/No tasks yet/i)).toBeInTheDocument();
  });
});
