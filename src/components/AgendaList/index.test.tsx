import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgendaList from './index';
import styles from './styles.module.css';
import type { AgendaItem } from '../../lib/agenda';

const NOW = new Date(2026, 7, 3, 14, 0, 0).getTime();
const HOUR = 3_600_000;

const item = (overrides: Partial<AgendaItem> & { key: string }): AgendaItem => ({
  source: 'task',
  id: overrides.key,
  title: 'Item',
  start: NOW + HOUR,
  end: NOW + HOUR,
  allDay: false,
  done: false,
  ...overrides,
});

/** Renders the list against the fixed clock, returning the toggle spy. */
function renderAgenda(items: AgendaItem[], emptyLabel = 'none') {
  const onToggleTask = vi.fn();
  const view = render(
    <AgendaList items={items} now={NOW} onToggleTask={onToggleTask} emptyLabel={emptyLabel} />,
  );
  return { ...view, onToggleTask };
}

describe('AgendaList', () => {
  it('shows the empty label when there is nothing to list', () => {
    renderAgenda([], 'All clear');

    expect(screen.getByText('All clear')).toBeInTheDocument();
  });

  it('renders a task as a checkbox', () => {
    renderAgenda([item({ key: 'a', title: 'Email Dana' })]);

    expect(screen.getByRole('checkbox', { name: 'Email Dana' })).toBeInTheDocument();
  });

  it('renders an event as a plain row', () => {
    renderAgenda([item({ key: 'b', title: 'Standup', source: 'event' })]);

    expect(screen.getByText('Standup')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Standup' })).not.toBeInTheDocument();
  });

  it('writes a completion back through the callback', async () => {
    const user = userEvent.setup();
    const { onToggleTask } = renderAgenda([
      item({ key: 'a', id: 'task-1', title: 'Email Dana' }),
    ]);

    await user.click(screen.getByRole('checkbox', { name: 'Email Dana' }));

    expect(onToggleTask).toHaveBeenCalledWith('task-1');
  });

  it('links an event out to Google Calendar when it has a URL', () => {
    renderAgenda([
      item({ key: 'a', title: 'Standup', source: 'event', url: 'https://cal.example' }),
    ]);

    expect(screen.getByRole('link', { name: 'Standup' })).toHaveAttribute(
      'href',
      'https://cal.example',
    );
  });

  it('replaces the clock with "Now" for an event in progress', () => {
    renderAgenda([item({ key: 'a', source: 'event', start: NOW - HOUR, end: NOW + HOUR })]);

    expect(screen.getByText('Now')).toBeInTheDocument();
  });

  it('marks a past-due unfinished task as overdue', () => {
    const { container } = renderAgenda([
      item({ key: 'a', title: 'Late', start: NOW - HOUR, end: NOW - HOUR }),
    ]);

    expect(container.querySelector('li')).toHaveClass(styles.isOverdue);
  });

  it('does not mark a completed past-due task as overdue', () => {
    const { container } = renderAgenda([
      item({ key: 'a', title: 'Late', start: NOW - HOUR, end: NOW - HOUR, done: true }),
    ]);

    const row = container.querySelector('li')!;
    expect(row).toHaveClass(styles.isDone);
    expect(row).not.toHaveClass(styles.isOverdue);
  });
});
