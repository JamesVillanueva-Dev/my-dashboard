import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TodayPanel from './index';
import styles from './styles.module.css';
import { DashboardDataProvider } from '../../hooks/DashboardDataProvider';
import type { Reminder } from '../../lib/gcalSync';

/** Renders the panel with the shared data provider it depends on. */
function renderPanel(props: { showFocus?: boolean } = {}) {
  return render(
    <DashboardDataProvider>
      <TodayPanel {...props} />
    </DashboardDataProvider>,
  );
}

/**
 * The "next up" headline text. Scoped to the headline because the same item also
 * appears in the timeline below, so a bare text query would match twice.
 */
function headline(container: HTMLElement): string {
  return container.querySelector(`.${styles.title}`)?.textContent ?? '';
}

/** Seeds the task list the provider reads on mount. */
function seedTasks(tasks: Reminder[]) {
  window.localStorage.setItem('reminders', JSON.stringify(tasks));
  // Skip the legacy To-do merge so it cannot perturb these fixtures.
  window.localStorage.setItem('tasks.mergedTodos', 'true');
}

/** A `datetime-local` string for an offset from now, which is what tasks store. */
function dueIn(ms: number): string {
  const d = new Date(Date.now() + ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

describe('TodayPanel', () => {
  beforeEach(() => {
    // Pin the clock to midday. This panel counts only what falls on today's
    // calendar date, so the multi-hour `dueIn` offsets below would cross
    // midnight — and drop out of the count — whenever the suite ran in the last
    // couple of hours of the day. That is a real failure on a UTC CI runner
    // while passing all afternoon locally. `shouldAdvanceTime` keeps the
    // panel's once-a-minute tick and userEvent's internal delays working.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 0, 15, 12, 0, 0));
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back to an empty state with no calendar and no tasks', () => {
    seedTasks([]);
    const { container } = renderPanel();
    expect(headline(container)).toBe('Nothing scheduled.');
    expect(screen.getByText(/Nothing on today/)).toBeInTheDocument();
    expect(screen.getByText('Nothing left today.')).toBeInTheDocument();
  });

  it('surfaces the soonest unfinished task as next up', () => {
    seedTasks([
      { id: '1', text: 'Later thing', due: dueIn(4 * 3_600_000), done: false },
      { id: '2', text: 'Sooner thing', due: dueIn(3_600_000), done: false },
    ]);
    const { container } = renderPanel();
    expect(headline(container)).toBe('Sooner thing');
  });

  it('skips completed tasks when choosing what is next', () => {
    seedTasks([
      { id: '1', text: 'Done already', due: dueIn(3_600_000), done: true },
      { id: '2', text: 'Still open', due: dueIn(2 * 3_600_000), done: false },
    ]);
    const { container } = renderPanel();
    expect(headline(container)).toBe('Still open');
  });

  it('counts what is left today', () => {
    seedTasks([
      { id: '1', text: 'One', due: dueIn(3_600_000), done: false },
      { id: '2', text: 'Two', due: dueIn(2 * 3_600_000), done: false },
    ]);
    renderPanel();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('tasks left')).toBeInTheDocument();
  });

  it('reports undated tasks separately, since they have no place on the timeline', () => {
    seedTasks([{ id: '1', text: 'Someday', due: '', done: false }]);
    renderPanel();
    expect(screen.getByText('undated')).toBeInTheDocument();
    expect(screen.getByText(/Nothing on today/)).toBeInTheDocument();
  });

  it('persists the daily focus', async () => {
    seedTasks([]);
    const user = userEvent.setup();
    renderPanel();

    const input = screen.getByLabelText(/one focus is/i);
    await user.type(input, 'Ship it');
    expect(input).toHaveValue('Ship it');

    const stored = JSON.parse(window.localStorage.getItem('focus')!);
    expect(stored.text).toBe('Ship it');
  });

  it('hides the focus field when it is switched off, keeping the rest of the zone', () => {
    seedTasks([{ id: '1', text: 'Email Dana', due: dueIn(3_600_000), done: false }]);
    const { container } = renderPanel({ showFocus: false });

    expect(screen.queryByLabelText(/one focus is/i)).not.toBeInTheDocument();
    // Everything else still works.
    expect(headline(container)).toBe('Email Dana');
    expect(screen.getByRole('checkbox', { name: 'Email Dana' })).toBeInTheDocument();
  });

  it('ticks a task done and writes it back to the shared list', async () => {
    seedTasks([{ id: 'task-1', text: 'Email Dana', due: dueIn(3_600_000), done: false }]);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('checkbox', { name: 'Email Dana' }));

    const stored = JSON.parse(window.localStorage.getItem('reminders')!) as Reminder[];
    expect(stored[0].done).toBe(true);
  });
});
