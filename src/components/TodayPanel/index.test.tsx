import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TodayPanel from './index';
import styles from './styles.module.css';
import { DashboardDataProvider } from '../../hooks/DashboardDataProvider';
import type { Reminder } from '../../lib/gcalSync';

// Google is unconfigured by default, which is what every test below except the
// connect one wants — it is the state a fresh dashboard is in.
const { google } = vi.hoisted(() => ({
  google: { configured: false, fetchUpcoming: vi.fn() },
}));

vi.mock('../../lib/googleAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/googleAuth')>()),
  hasGoogleClientId: () => google.configured,
}));
vi.mock('../../lib/gcalEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/gcalEvents')>()),
  fetchUpcoming: (...args: unknown[]) => google.fetchUpcoming(...args),
}));

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
    google.configured = false;
    google.fetchUpcoming.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back to an empty state with no calendar and no tasks', () => {
    seedTasks([]);
    const { container } = renderPanel();
    expect(headline(container)).toBe('Nothing scheduled.');
    expect(screen.getByText(/Nothing on today/)).toBeInTheDocument();
    // The stat strip stays away entirely rather than adding a third way of
    // saying the same thing.
    expect(screen.queryByText('Nothing left today.')).not.toBeInTheDocument();
  });

  it('names the zone for assistive tech without printing a label above it', () => {
    seedTasks([]);
    renderPanel();

    // "Next up" survives as the section's accessible name and as the heading
    // the "Today" sub-heading hangs off — it just is not drawn.
    const heading = screen.getByRole('heading', { name: 'Next up', level: 2 });
    expect(heading).toHaveClass(styles.srOnly);
    expect(screen.getByRole('region', { name: 'Next up' })).toBeInTheDocument();
  });

  it('offers connecting the calendar as a button inside the headline', async () => {
    google.configured = true;
    seedTasks([]);
    const user = userEvent.setup();
    const { container } = renderPanel();

    const connect = screen.getByRole('button', { name: 'Connect your calendar' });
    // The control is the sentence, not a button sitting under one.
    expect(connect.closest(`.${styles.title}`)).not.toBeNull();
    expect(headline(container)).toBe('Connect your calendar to see what’s coming.');

    await user.click(connect);
    // Interactive, so Google is allowed to show its consent popup.
    expect(google.fetchUpcoming).toHaveBeenCalledWith(true, expect.any(Number));
  });

  it('offers no connect button when there is no Google client id to connect with', () => {
    seedTasks([]);
    const { container } = renderPanel();
    expect(screen.queryByRole('button', { name: /connect your calendar/i })).not.toBeInTheDocument();
    expect(headline(container)).toBe('Nothing scheduled.');
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

  it('asks for nothing until asked — no empty field sitting in the lead row', () => {
    seedTasks([]);
    renderPanel();

    // The old shape was a text box that was blank almost every time you looked
    // at it. What's here now is an offer, not a demand.
    expect(screen.queryByRole('textbox', { name: /one focus is/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set a focus' })).toBeInTheDocument();
  });

  it('opens the field on the prompt, with the caret already in it', async () => {
    seedTasks([]);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Set a focus' }));

    const input = screen.getByLabelText(/one focus is/i);
    expect(input).toBeInTheDocument();
    // The click asked for the field, so it should not also have to be clicked.
    expect(input).toHaveFocus();
  });

  it('persists the daily focus', async () => {
    seedTasks([]);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Set a focus' }));
    const input = screen.getByLabelText(/one focus is/i);
    await user.type(input, 'Ship it');
    expect(input).toHaveValue('Ship it');

    const stored = JSON.parse(window.localStorage.getItem('focus')!);
    expect(stored.text).toBe('Ship it');
  });

  it('reads as a statement once set, and reopens for editing on a click', async () => {
    seedTasks([]);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Set a focus' }));
    await user.type(screen.getByLabelText(/one focus is/i), 'Ship it{Enter}');

    // Committed: the input is gone and the focus reads as plain text.
    expect(screen.queryByRole('textbox', { name: /one focus is/i })).not.toBeInTheDocument();
    const set = screen.getByRole('button', { name: 'Edit today’s focus: Ship it' });
    expect(set).toHaveTextContent('Ship it');

    await user.click(set);
    expect(screen.getByLabelText(/one focus is/i)).toHaveValue('Ship it');
  });

  it('goes back to offering when the focus is cleared', async () => {
    seedTasks([]);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Set a focus' }));
    const input = screen.getByLabelText(/one focus is/i);
    await user.type(input, 'Ship it');
    await user.clear(input);
    await user.tab();

    expect(screen.getByRole('button', { name: 'Set a focus' })).toBeInTheDocument();
  });

  it('hides the focus field when it is switched off, keeping the rest of the zone', () => {
    seedTasks([{ id: '1', text: 'Email Dana', due: dueIn(3_600_000), done: false }]);
    const { container } = renderPanel({ showFocus: false });

    expect(screen.queryByRole('button', { name: 'Set a focus' })).not.toBeInTheDocument();
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
