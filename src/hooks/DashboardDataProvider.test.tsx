import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { DashboardDataProvider } from './DashboardDataProvider';
import { useDashboardData } from './useDashboardData';
import { useUpcomingEvents, type UpcomingEvents } from './useUpcomingEvents';
import { useCalendarSync, type CalendarSync } from './useCalendarSync';
import { toEvent, type CalendarEvent } from '../lib/gcalEvents';
import type { Reminder } from '../lib/gcalSync';

// The two Google-backed hooks are covered by their own suites; stubbing them
// keeps this one about the state the provider actually owns.
vi.mock('./useUpcomingEvents', () => ({ useUpcomingEvents: vi.fn() }));
vi.mock('./useCalendarSync', () => ({ useCalendarSync: vi.fn() }));

/** 3 August 2026, 10:00 local. */
const NOW = new Date(2026, 7, 3, 10).getTime();

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return { id: 'r1', text: 'Task', due: '', done: false, ...overrides };
}

function event(id: string, start: Date, end: Date): CalendarEvent {
  const converted = toEvent(
    {
      id,
      summary: id,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    },
    'cal-1',
  );
  if (!converted) throw new Error('fixture did not convert');
  return converted;
}

const emptySync: CalendarSync = {
  configured: false,
  connected: false,
  syncing: false,
  error: '',
  connect: vi.fn(),
  disconnect: vi.fn(),
  syncNow: vi.fn(),
};

function upcoming(overrides: Partial<UpcomingEvents> = {}): UpcomingEvents {
  return {
    configured: false,
    connected: false,
    loading: false,
    error: '',
    events: [],
    now: NOW,
    lastLoaded: 0,
    connect: vi.fn(),
    disconnect: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <DashboardDataProvider>{children}</DashboardDataProvider>;
}

/** Mounts the provider and returns the shared state. */
function renderDashboardData() {
  return renderHook(() => useDashboardData(), { wrapper });
}

/** Seeds the stored task list. */
const seedTasks = (tasks: Reminder[]) =>
  localStorage.setItem('reminders', JSON.stringify(tasks));

/** Seeds the retired To-do widget's list. */
const seedLegacyTodos = (todos: unknown) => localStorage.setItem('todos', JSON.stringify(todos));

/** The arguments the provider last handed the sync hook. */
const lastSyncArgs = () => vi.mocked(useCalendarSync).mock.calls.at(-1)!;

beforeEach(() => {
  vi.mocked(useUpcomingEvents).mockReturnValue(upcoming());
  vi.mocked(useCalendarSync).mockReturnValue(emptySync);
});

describe('useDashboardData', () => {
  it('throws outside the provider rather than handing back a private copy', () => {
    // Two components each owning the list would silently diverge; failing loudly
    // is the point.
    expect(() => renderHook(() => useDashboardData())).toThrow(
      /must be used inside a <DashboardDataProvider>/,
    );
  });
});

describe('DashboardDataProvider on mount', () => {
  it('starts with an empty task list', () => {
    const { result } = renderDashboardData();

    expect(result.current.tasks).toEqual([]);
  });

  it('reads the stored task list', () => {
    seedTasks([reminder({ text: 'Buy milk' })]);

    const { result } = renderDashboardData();

    expect(result.current.tasks).toEqual([reminder({ text: 'Buy milk' })]);
  });

  it('shares the calendar sync and upcoming events straight through', () => {
    const events = upcoming({ connected: true });
    vi.mocked(useUpcomingEvents).mockReturnValue(events);

    const { result } = renderDashboardData();

    expect(result.current.cal).toBe(emptySync);
    expect(result.current.upcoming).toBe(events);
    expect(result.current.now).toBe(NOW);
  });
});

describe('DashboardDataProvider tasks', () => {
  it('persists a replaced list', () => {
    const { result } = renderDashboardData();

    act(() => result.current.setTasks([reminder({ text: 'New' })]));

    expect(result.current.tasks).toEqual([reminder({ text: 'New' })]);
    expect(JSON.parse(localStorage.getItem('reminders')!)).toEqual([reminder({ text: 'New' })]);
  });

  it('marks a task done', () => {
    seedTasks([reminder()]);
    const { result } = renderDashboardData();

    act(() => result.current.toggleTask('r1'));

    expect(result.current.tasks[0].done).toBe(true);
  });

  it('marks a done task open again', () => {
    seedTasks([reminder({ done: true })]);
    const { result } = renderDashboardData();

    act(() => result.current.toggleTask('r1'));

    expect(result.current.tasks[0].done).toBe(false);
  });

  it('leaves the other tasks alone when toggling one', () => {
    seedTasks([reminder(), reminder({ id: 'r2', text: 'Other' })]);
    const { result } = renderDashboardData();

    act(() => result.current.toggleTask('r1'));

    expect(result.current.tasks[1]).toEqual(reminder({ id: 'r2', text: 'Other' }));
  });

  it('ignores a toggle for an id that is not there', () => {
    seedTasks([reminder()]);
    const { result } = renderDashboardData();

    act(() => result.current.toggleTask('missing'));

    expect(result.current.tasks).toEqual([reminder()]);
  });
});

describe('DashboardDataProvider merging the retired To-do widget', () => {
  it('folds the old list in as undated tasks', () => {
    seedLegacyTodos([{ id: 't1', text: 'Old todo', done: false }]);

    const { result } = renderDashboardData();

    expect(result.current.tasks).toEqual([
      { id: 'todo-t1', text: 'Old todo', due: '', done: false },
    ]);
  });

  it('keeps existing tasks and appends the migrated ones', () => {
    seedTasks([reminder()]);
    seedLegacyTodos([{ id: 't1', text: 'Old todo', done: true }]);

    const { result } = renderDashboardData();

    expect(result.current.tasks.map((task) => task.id)).toEqual(['r1', 'todo-t1']);
  });

  it('records that it has run, so it never runs twice', () => {
    seedLegacyTodos([{ id: 't1', text: 'Old todo', done: false }]);

    const { result } = renderDashboardData();

    expect(JSON.parse(localStorage.getItem('tasks.mergedTodos')!)).toBe(true);
    expect(result.current.tasks).toHaveLength(1);
  });

  it('does nothing on a dashboard that has already merged', () => {
    localStorage.setItem('tasks.mergedTodos', JSON.stringify(true));
    seedLegacyTodos([{ id: 't1', text: 'Old todo', done: false }]);

    const { result } = renderDashboardData();

    expect(result.current.tasks).toEqual([]);
  });

  it('leaves the legacy key in place as a rollback path', () => {
    const stored = JSON.stringify([{ id: 't1', text: 'Old todo', done: false }]);
    localStorage.setItem('todos', stored);

    renderDashboardData();

    expect(localStorage.getItem('todos')).toBe(stored);
  });

  it('survives a corrupt legacy value instead of blanking the dashboard', () => {
    seedLegacyTodos({ not: 'an array' });

    const { result } = renderDashboardData();

    expect(result.current.tasks).toEqual([]);
  });
});

describe('DashboardDataProvider agenda', () => {
  it('merges calendar events and dated tasks into one sorted timeline', () => {
    vi.mocked(useUpcomingEvents).mockReturnValue(
      upcoming({ events: [event('standup', new Date(2026, 7, 3, 14), new Date(2026, 7, 3, 15))] }),
    );
    seedTasks([reminder({ text: 'Call back', due: '2026-08-03T11:00' })]);

    const { result } = renderDashboardData();

    expect(result.current.agenda.map((item) => item.title)).toEqual(['Call back', 'standup']);
    expect(result.current.agenda.map((item) => item.source)).toEqual(['task', 'event']);
  });

  it('leaves undated tasks off the timeline', () => {
    seedTasks([reminder({ text: 'Someday' })]);

    const { result } = renderDashboardData();

    expect(result.current.agenda).toEqual([]);
  });

  it('excludes deleted tasks', () => {
    seedTasks([reminder({ due: '2026-08-03T11:00', deleted: true })]);

    const { result } = renderDashboardData();

    expect(result.current.agenda).toEqual([]);
  });
});

describe('DashboardDataProvider counts', () => {
  it('totals what is left of the day', () => {
    vi.mocked(useUpcomingEvents).mockReturnValue(
      upcoming({
        events: [
          event('later', new Date(2026, 7, 3, 14), new Date(2026, 7, 3, 15)),
          event('done', new Date(2026, 7, 3, 8), new Date(2026, 7, 3, 9)),
        ],
      }),
    );
    seedTasks([
      reminder({ id: 'a', text: 'Due later', due: '2026-08-03T16:00' }),
      reminder({ id: 'b', text: 'Overdue', due: '2026-08-03T09:00' }),
      reminder({ id: 'c', text: 'Undated' }),
      reminder({ id: 'd', text: 'Finished', done: true }),
    ]);

    const { result } = renderDashboardData();

    expect(result.current.counts).toEqual({
      remainingToday: 2,
      overdue: 1,
      eventsLeft: 1,
      undated: 1,
    });
  });

  it('counts nothing on an empty dashboard', () => {
    const { result } = renderDashboardData();

    expect(result.current.counts).toEqual({
      remainingToday: 0,
      overdue: 0,
      eventsLeft: 0,
      undated: 0,
    });
  });

  it('leaves deleted tasks out of the undated count', () => {
    seedTasks([reminder({ text: 'Gone', deleted: true })]);

    const { result } = renderDashboardData();

    expect(result.current.counts.undated).toBe(0);
  });
});

describe('DashboardDataProvider and the calendar sync hook', () => {
  it('gives it a getter that sees the current tasks', () => {
    seedTasks([reminder()]);
    renderDashboardData();

    const [getReminders] = lastSyncArgs();

    expect(getReminders()).toEqual([reminder()]);
  });

  it('gives it a getter that sees later edits, with no stale closure', () => {
    seedTasks([reminder()]);
    const { result } = renderDashboardData();
    const [getReminders] = lastSyncArgs();

    act(() => result.current.setTasks([reminder({ text: 'Edited' })]));

    expect(getReminders()).toEqual([reminder({ text: 'Edited' })]);
  });

  it('writes the reconciled list back when sync hands one over', () => {
    const { result } = renderDashboardData();
    const [, setReminders] = lastSyncArgs();

    act(() => setReminders([reminder({ text: 'From Google' })]));

    expect(result.current.tasks).toEqual([reminder({ text: 'From Google' })]);
  });
});
