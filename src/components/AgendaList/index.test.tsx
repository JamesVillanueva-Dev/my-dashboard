import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgendaList from './index';
import styles from './styles.module.css';
import type { AgendaItem } from '../../lib/agenda';

const NOW = new Date(2026, 7, 3, 14, 0, 0).getTime();
const HOUR = 3_600_000;

const item = (over: Partial<AgendaItem> & { key: string }): AgendaItem => ({
  source: 'task',
  id: over.key,
  title: 'Item',
  start: NOW + HOUR,
  end: NOW + HOUR,
  allDay: false,
  done: false,
  ...over,
});

describe('AgendaList', () => {
  it('shows the empty label when there is nothing to list', () => {
    render(<AgendaList items={[]} now={NOW} onToggleTask={() => {}} emptyLabel="All clear" />);
    expect(screen.getByText('All clear')).toBeInTheDocument();
  });

  it('renders tasks as checkboxes and events as plain rows', () => {
    render(
      <AgendaList
        items={[
          item({ key: 'a', title: 'Email Dana' }),
          item({ key: 'b', title: 'Standup', source: 'event' }),
        ]}
        now={NOW}
        onToggleTask={() => {}}
        emptyLabel="none"
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Email Dana' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Standup' })).not.toBeInTheDocument();
    expect(screen.getByText('Standup')).toBeInTheDocument();
  });

  it('writes a completion back through the callback', async () => {
    const onToggleTask = vi.fn();
    const user = userEvent.setup();
    render(
      <AgendaList
        items={[item({ key: 'a', id: 'task-1', title: 'Email Dana' })]}
        now={NOW}
        onToggleTask={onToggleTask}
        emptyLabel="none"
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Email Dana' }));
    expect(onToggleTask).toHaveBeenCalledWith('task-1');
  });

  it('links an event out to Google Calendar when it has a URL', () => {
    render(
      <AgendaList
        items={[item({ key: 'a', title: 'Standup', source: 'event', url: 'https://cal.example' })]}
        now={NOW}
        onToggleTask={() => {}}
        emptyLabel="none"
      />,
    );
    expect(screen.getByRole('link', { name: 'Standup' })).toHaveAttribute(
      'href',
      'https://cal.example',
    );
  });

  it('replaces the clock with "Now" for an event in progress', () => {
    render(
      <AgendaList
        items={[item({ key: 'a', source: 'event', start: NOW - HOUR, end: NOW + HOUR })]}
        now={NOW}
        onToggleTask={() => {}}
        emptyLabel="none"
      />,
    );
    expect(screen.getByText('Now')).toBeInTheDocument();
  });

  it('marks a past-due unfinished task as overdue', () => {
    const { container } = render(
      <AgendaList
        items={[item({ key: 'a', title: 'Late', start: NOW - HOUR, end: NOW - HOUR })]}
        now={NOW}
        onToggleTask={() => {}}
        emptyLabel="none"
      />,
    );
    expect(container.querySelector('li')).toHaveClass(styles.isOverdue);
  });

  it('does not mark a completed past-due task as overdue', () => {
    const { container } = render(
      <AgendaList
        items={[item({ key: 'a', title: 'Late', start: NOW - HOUR, end: NOW - HOUR, done: true })]}
        now={NOW}
        onToggleTask={() => {}}
        emptyLabel="none"
      />,
    );
    const row = container.querySelector('li')!;
    expect(row).toHaveClass(styles.isDone);
    expect(row).not.toHaveClass(styles.isOverdue);
  });
});
