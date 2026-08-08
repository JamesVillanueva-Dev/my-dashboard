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

const HOUR = 3_600_000;

/** `fetchUpcoming`'s first argument: whether a consent popup is allowed. */
const INTERACTIVE = true;

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
  const due = new Date(Date.now() + ms);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T${pad(due.getHours())}:${pad(due.getMinutes())}`;
}

/** The daily-focus field, once it has been opened. */
const focusField = () => screen.getByLabelText(/one focus is/i);

/** Opens the daily-focus field from its prompt. */
const openFocusField = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Set a focus' }));

/** The stored daily focus. */
const storedFocus = () => JSON.parse(window.localStorage.getItem('focus')!);

/** The stored task list. */
const storedTasks = () => JSON.parse(window.localStorage.getItem('reminders')!) as Reminder[];

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

describe('TodayPanel with nothing to show', () => {
  it('falls back to an empty state', () => {
    seedTasks([]);

    const { container } = renderPanel();

    expect(headline(container)).toBe('Nothing scheduled.');
    expect(screen.getByText(/Nothing on today/)).toBeInTheDocument();
  });

  it('keeps the stat strip away rather than saying it a third time', () => {
    seedTasks([]);

    renderPanel();

    expect(screen.queryByText('Nothing left today.')).not.toBeInTheDocument();
  });

  it('names the zone for assistive tech without printing a label above it', () => {
    seedTasks([]);

    renderPanel();

    // "Next up" survives as the section's accessible name and as the heading
    // the "Today" sub-heading hangs off — it just is not drawn.
    expect(screen.getByRole('heading', { name: 'Next up', level: 2 })).toHaveClass(styles.srOnly);
    expect(screen.getByRole('region', { name: 'Next up' })).toBeInTheDocument();
  });
});

describe('TodayPanel calendar connection', () => {
  it('offers connecting the calendar as the headline itself', () => {
    google.configured = true;
    seedTasks([]);

    const { container } = renderPanel();

    const connect = screen.getByRole('button', { name: 'Connect your calendar' });
    // The control is the sentence, not a button sitting under one.
    expect(connect.closest(`.${styles.title}`)).not.toBeNull();
    expect(headline(container)).toBe('Connect your calendar to see what’s coming.');
  });

  it('lets Google show its consent popup when that button is used', async () => {
    google.configured = true;
    seedTasks([]);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Connect your calendar' }));

    expect(google.fetchUpcoming).toHaveBeenCalledWith(INTERACTIVE, expect.any(Number));
  });

  it('offers no connect button when there is no Google client id to connect with', () => {
    seedTasks([]);

    const { container } = renderPanel();

    expect(
      screen.queryByRole('button', { name: /connect your calendar/i }),
    ).not.toBeInTheDocument();
    expect(headline(container)).toBe('Nothing scheduled.');
  });
});

describe('TodayPanel next up', () => {
  it('surfaces the soonest unfinished task', () => {
    seedTasks([
      { id: '1', text: 'Later thing', due: dueIn(4 * HOUR), done: false },
      { id: '2', text: 'Sooner thing', due: dueIn(HOUR), done: false },
    ]);

    const { container } = renderPanel();

    expect(headline(container)).toBe('Sooner thing');
  });

  it('skips completed tasks when choosing what is next', () => {
    seedTasks([
      { id: '1', text: 'Done already', due: dueIn(HOUR), done: true },
      { id: '2', text: 'Still open', due: dueIn(2 * HOUR), done: false },
    ]);

    const { container } = renderPanel();

    expect(headline(container)).toBe('Still open');
  });

  it('counts what is left today', () => {
    seedTasks([
      { id: '1', text: 'One', due: dueIn(HOUR), done: false },
      { id: '2', text: 'Two', due: dueIn(2 * HOUR), done: false },
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

  it('ticks a task done and writes it back to the shared list', async () => {
    seedTasks([{ id: 'task-1', text: 'Email Dana', due: dueIn(HOUR), done: false }]);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('checkbox', { name: 'Email Dana' }));

    expect(storedTasks()[0].done).toBe(true);
  });
});

describe('TodayPanel daily focus', () => {
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

    await openFocusField(user);

    // The click asked for the field, so it should not also have to be clicked.
    expect(focusField()).toBeInTheDocument();
    expect(focusField()).toHaveFocus();
  });

  it('persists what is typed', async () => {
    seedTasks([]);
    const user = userEvent.setup();
    renderPanel();

    await openFocusField(user);
    await user.type(focusField(), 'Ship it');

    expect(focusField()).toHaveValue('Ship it');
    expect(storedFocus().text).toBe('Ship it');
  });

  it('reads as a statement once committed', async () => {
    seedTasks([]);
    const user = userEvent.setup();
    renderPanel();

    await openFocusField(user);
    await user.type(focusField(), 'Ship it{Enter}');

    expect(screen.queryByRole('textbox', { name: /one focus is/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit today’s focus: Ship it' })).toHaveTextContent(
      'Ship it',
    );
  });

  it('reopens for editing on a click', async () => {
    seedTasks([]);
    const user = userEvent.setup();
    renderPanel();
    await openFocusField(user);
    await user.type(focusField(), 'Ship it{Enter}');

    await user.click(screen.getByRole('button', { name: 'Edit today’s focus: Ship it' }));

    expect(focusField()).toHaveValue('Ship it');
  });

  it('goes back to offering when the focus is cleared', async () => {
    seedTasks([]);
    const user = userEvent.setup();
    renderPanel();

    await openFocusField(user);
    await user.type(focusField(), 'Ship it');
    await user.clear(focusField());
    await user.tab();

    expect(screen.getByRole('button', { name: 'Set a focus' })).toBeInTheDocument();
  });

  it('disappears when switched off', () => {
    seedTasks([{ id: '1', text: 'Email Dana', due: dueIn(HOUR), done: false }]);

    renderPanel({ showFocus: false });

    expect(screen.queryByRole('button', { name: 'Set a focus' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/one focus is/i)).not.toBeInTheDocument();
  });

  it('leaves the rest of the zone working when switched off', () => {
    seedTasks([{ id: '1', text: 'Email Dana', due: dueIn(HOUR), done: false }]);

    const { container } = renderPanel({ showFocus: false });

    expect(headline(container)).toBe('Email Dana');
    expect(screen.getByRole('checkbox', { name: 'Email Dana' })).toBeInTheDocument();
  });
});
