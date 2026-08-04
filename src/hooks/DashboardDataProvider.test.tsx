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

function reminder(over: Partial<Reminder> = {}): Reminder {
  return { id: 'r1', text: 'Task', due: '', done: false, ...over };
}

function event(id: string, start: Date, end: Date): CalendarEvent {
  const ev = toEvent(
    { id, summary: id, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } },
    'cal-1',
  );
  if (!ev) throw new Error('fixture did not convert');
  return ev;
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

function upcoming(over: Partial<UpcomingEvents> = {}): UpcomingEvents {
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
    ...over,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <DashboardDataProvider>{children}</DashboardDataProvider>;
}

/** Mounts the provider and returns the shared state. */
function setup() {
  return renderHook(() => useDashboardData(), { wrapper });
}

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

describe('DashboardDataProvider', () => {
  it('starts with an empty task list', () => {
    const { result } = setup();

    expect(result.current.tasks).toEqual([]);
  });

  it('reads the stored task list', () => {
    localStorage.setItem('reminders', JSON.stringify([reminder({ text: 'Buy milk' })]));

    const { result } = setup();

    expect(result.current.tasks).toEqual([reminder({ text: 'Buy milk' })]);
  });

  it('shares the calendar sync and upcoming events straight through', () => {
    const events = upcoming({ connected: true });
    vi.mocked(useUpcomingEvents).mockReturnValue(events);

    const { result } = setup();

    expect(result.current.cal).toBe(emptySync);
    expect(result.current.upcoming).toBe(events);
    expect(result.current.now).toBe(NOW);
  });

  describe('tasks', () => {
    it('persists a replaced list', () => {
      const { result } = setup();

      act(() => result.current.setTasks([reminder({ text: 'New' })]));

      expect(result.current.tasks).toEqual([reminder({ text: 'New' })]);
      expect(JSON.parse(localStorage.getItem('reminders')!)).toEqual([reminder({ text: 'New' })]);
    });

    it('toggles a task done and back', () => {
      localStorage.setItem('reminders', JSON.stringify([reminder()]));
      const { result } = setup();

      act(() => result.current.toggleTask('r1'));
      expect(result.current.tasks[0].done).toBe(true);

      act(() => result.current.toggleTask('r1'));
      expect(result.current.tasks[0].done).toBe(false);
    });

    it('leaves the other tasks alone when toggling one', () => {
      localStorage.setItem(
        'reminders',
        JSON.stringify([reminder(), reminder({ id: 'r2', text: 'Other' })]),
      );
      const { result } = setup();

      act(() => result.current.toggleTask('r1'));

      expect(result.current.tasks[1]).toEqual(reminder({ id: 'r2', text: 'Other' }));
    });

    it('ignores a toggle for an id that is not there', () => {
      localStorage.setItem('reminders', JSON.stringify([reminder()]));
      const { result } = setup();

      act(() => result.current.toggleTask('missing'));

      expect(result.current.tasks).toEqual([reminder()]);
    });
  });

  describe('the one-time To-do merge', () => {
    it('folds the retired widget’s list in as undated tasks', () => {
      localStorage.setItem(
        'todos',
        JSON.stringify([{ id: 't1', text: 'Old todo', done: false }]),
      );

      const { result } = setup();

      expect(result.current.tasks).toEqual([
        { id: 'todo-t1', text: 'Old todo', due: '', done: false },
      ]);
    });

    it('keeps existing tasks and appends the migrated ones', () => {
      localStorage.setItem('reminders', JSON.stringify([reminder()]));
      localStorage.setItem('todos', JSON.stringify([{ id: 't1', text: 'Old todo', done: true }]));

      const { result } = setup();

      expect(result.current.tasks.map((t) => t.id)).toEqual(['r1', 'todo-t1']);
    });

    it('records that it has run, so it never runs twice', () => {
      localStorage.setItem('todos', JSON.stringify([{ id: 't1', text: 'Old todo', done: false }]));

      const { result } = setup();

      expect(JSON.parse(localStorage.getItem('tasks.mergedTodos')!)).toBe(true);
      expect(result.current.tasks).toHaveLength(1);
    });

    it('does nothing on a dashboard that has already merged', () => {
      localStorage.setItem('tasks.mergedTodos', JSON.stringify(true));
      localStorage.setItem('todos', JSON.stringify([{ id: 't1', text: 'Old todo', done: false }]));

      const { result } = setup();

      expect(result.current.tasks).toEqual([]);
    });

    it('leaves the legacy key in place as a rollback path', () => {
      const stored = JSON.stringify([{ id: 't1', text: 'Old todo', done: false }]);
      localStorage.setItem('todos', stored);

      setup();

      expect(localStorage.getItem('todos')).toBe(stored);
    });

    it('survives a corrupt legacy value instead of blanking the dashboard', () => {
      localStorage.setItem('todos', JSON.stringify({ not: 'an array' }));

      const { result } = setup();

      expect(result.current.tasks).toEqual([]);
    });
  });

  describe('agenda', () => {
    it('merges calendar events and dated tasks into one sorted timeline', () => {
      vi.mocked(useUpcomingEvents).mockReturnValue(
        upcoming({ events: [event('standup', new Date(2026, 7, 3, 14), new Date(2026, 7, 3, 15))] }),
      );
      localStorage.setItem(
        'reminders',
        JSON.stringify([reminder({ text: 'Call back', due: '2026-08-03T11:00' })]),
      );

      const { result } = setup();

      expect(result.current.agenda.map((i) => i.title)).toEqual(['Call back', 'standup']);
      expect(result.current.agenda.map((i) => i.source)).toEqual(['task', 'event']);
    });

    it('leaves undated tasks off the timeline', () => {
      localStorage.setItem('reminders', JSON.stringify([reminder({ text: 'Someday' })]));

      const { result } = setup();

      expect(result.current.agenda).toEqual([]);
    });

    it('excludes deleted tasks', () => {
      localStorage.setItem(
        'reminders',
        JSON.stringify([reminder({ due: '2026-08-03T11:00', deleted: true })]),
      );

      const { result } = setup();

      expect(result.current.agenda).toEqual([]);
    });
  });

  describe('counts', () => {
    it('totals what is left of the day', () => {
      vi.mocked(useUpcomingEvents).mockReturnValue(
        upcoming({
          events: [
            event('later', new Date(2026, 7, 3, 14), new Date(2026, 7, 3, 15)),
            event('done', new Date(2026, 7, 3, 8), new Date(2026, 7, 3, 9)),
          ],
        }),
      );
      localStorage.setItem(
        'reminders',
        JSON.stringify([
          reminder({ id: 'a', text: 'Due later', due: '2026-08-03T16:00' }),
          reminder({ id: 'b', text: 'Overdue', due: '2026-08-03T09:00' }),
          reminder({ id: 'c', text: 'Undated' }),
          reminder({ id: 'd', text: 'Finished', done: true }),
        ]),
      );

      const { result } = setup();

      expect(result.current.counts).toEqual({
        remainingToday: 2,
        overdue: 1,
        eventsLeft: 1,
        undated: 1,
      });
    });

    it('counts nothing on an empty dashboard', () => {
      const { result } = setup();

      expect(result.current.counts).toEqual({
        remainingToday: 0,
        overdue: 0,
        eventsLeft: 0,
        undated: 0,
      });
    });

    it('leaves deleted tasks out of the undated count', () => {
      localStorage.setItem(
        'reminders',
        JSON.stringify([reminder({ text: 'Gone', deleted: true })]),
      );

      const { result } = setup();

      expect(result.current.counts.undated).toBe(0);
    });
  });

  it('gives the sync hook a live view of the tasks', () => {
    localStorage.setItem('reminders', JSON.stringify([reminder()]));
    const { result } = setup();

    const [getReminders] = vi.mocked(useCalendarSync).mock.calls.at(-1)!;
    expect(getReminders()).toEqual([reminder()]);

    act(() => result.current.setTasks([reminder({ text: 'Edited' })]));

    // The same getter, called again, sees the edit — no stale closure.
    expect(getReminders()).toEqual([reminder({ text: 'Edited' })]);
  });

  it('writes the reconciled list back when sync hands one over', () => {
    const { result } = setup();
    const [, setReminders] = vi.mocked(useCalendarSync).mock.calls.at(-1)!;

    act(() => setReminders([reminder({ text: 'From Google' })]));

    expect(result.current.tasks).toEqual([reminder({ text: 'From Google' })]);
  });
});
