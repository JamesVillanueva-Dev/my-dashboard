import { describe, it, expect } from 'vitest';
import {
  buildAgenda,
  countAgenda,
  fromTask,
  isInProgress,
  nextUp,
  occursOn,
  overdueItems,
  relativeLabel,
  sortAgenda,
  startOfDay,
  timeLabel,
  todayItems,
  type AgendaItem,
} from './agenda';
import type { CalendarEvent } from './gcalEvents';
import type { Reminder } from './gcalSync';

/** 2026-08-03 14:00 local — the "now" every test runs against. */
const NOW = new Date(2026, 7, 3, 14, 0, 0).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Local midnight on the day containing NOW. */
const TODAY_0 = startOfDay(NOW);

function event(over: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    calendarId: 'cal',
    title: 'Event',
    start: NOW + HOUR,
    end: NOW + 2 * HOUR,
    allDay: false,
    ...over,
  };
}

/** Builds a task with a `datetime-local`-shaped due string from a timestamp. */
function task(over: Partial<Reminder> & { id: string }, dueAt?: number): Reminder {
  const due =
    dueAt === undefined
      ? ''
      : (() => {
          const d = new Date(dueAt);
          const p = (n: number) => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
        })();
  return { text: 'Task', due, done: false, ...over };
}

describe('fromTask', () => {
  it('drops undated tasks — they cannot be placed on a timeline', () => {
    expect(fromTask(task({ id: 'a' }))).toBeNull();
  });

  it('drops tombstoned tasks awaiting a sync', () => {
    expect(fromTask(task({ id: 'a', deleted: true }, NOW))).toBeNull();
  });

  it('drops tasks whose due string will not parse', () => {
    expect(fromTask({ id: 'a', text: 'x', due: 'not-a-date', done: false })).toBeNull();
  });

  it('parses a datetime-local due string as local time', () => {
    const item = fromTask(task({ id: 'a' }, NOW))!;
    // Minute precision: the due string carries no seconds.
    expect(item.start).toBe(new Date(2026, 7, 3, 14, 0, 0).getTime());
    expect(item.end).toBe(item.start);
    expect(item.source).toBe('task');
  });

  it('carries completion through', () => {
    expect(fromTask(task({ id: 'a', done: true }, NOW))!.done).toBe(true);
  });
});

describe('occursOn', () => {
  const on = (item: Partial<AgendaItem>) =>
    occursOn(
      { key: 'k', source: 'event', id: 'i', title: 't', allDay: false, done: false, start: 0, end: 0, ...item },
      NOW,
    );

  it('includes an item starting at local midnight today', () => {
    expect(on({ start: TODAY_0, end: TODAY_0 })).toBe(true);
  });

  it('excludes an item at the last instant of yesterday', () => {
    expect(on({ start: TODAY_0 - 1, end: TODAY_0 - 1 })).toBe(false);
  });

  it('excludes an item at midnight starting tomorrow', () => {
    expect(on({ start: TODAY_0 + DAY, end: TODAY_0 + DAY })).toBe(false);
  });

  it('includes a multi-day event that started before today and ends after', () => {
    expect(on({ start: TODAY_0 - 2 * DAY, end: TODAY_0 + 2 * DAY })).toBe(true);
  });

  it('includes an all-day event covering exactly today', () => {
    expect(on({ start: TODAY_0, end: TODAY_0 + DAY, allDay: true })).toBe(true);
  });
});

describe('sortAgenda', () => {
  it('pins all-day items above timed ones on the same day', () => {
    const items = buildAgenda(
      [
        event({ id: 'timed', title: 'Timed', start: TODAY_0 + 9 * HOUR, end: TODAY_0 + 10 * HOUR }),
        event({ id: 'allday', title: 'All day', start: TODAY_0, end: TODAY_0 + DAY, allDay: true }),
      ],
      [],
    );
    expect(items.map((i) => i.title)).toEqual(['All day', 'Timed']);
  });

  it('lets chronology win across different days', () => {
    const items = buildAgenda(
      [
        event({ id: 'a', title: 'Tomorrow all-day', start: TODAY_0 + DAY, end: TODAY_0 + 2 * DAY, allDay: true }),
        event({ id: 'b', title: 'Today timed', start: TODAY_0 + 9 * HOUR, end: TODAY_0 + 10 * HOUR }),
      ],
      [],
    );
    expect(items.map((i) => i.title)).toEqual(['Today timed', 'Tomorrow all-day']);
  });

  it('is stable for identical times, breaking ties on title then key', () => {
    const base = { start: NOW, end: NOW, allDay: false, done: false, source: 'event' as const };
    const items = sortAgenda([
      { ...base, key: 'b', id: 'b', title: 'Same' },
      { ...base, key: 'a', id: 'a', title: 'Same' },
    ]);
    expect(items.map((i) => i.key)).toEqual(['a', 'b']);
  });
});

describe('todayItems', () => {
  it('keeps today and drops other days', () => {
    const items = buildAgenda(
      [
        event({ id: 'today', title: 'Today', start: NOW + HOUR, end: NOW + 2 * HOUR }),
        event({ id: 'tomorrow', title: 'Tomorrow', start: NOW + DAY, end: NOW + DAY + HOUR }),
        event({ id: 'yesterday', title: 'Yesterday', start: NOW - DAY, end: NOW - DAY + HOUR }),
      ],
      [],
    );
    expect(todayItems(items, NOW).map((i) => i.title)).toEqual(['Today']);
  });

  it('keeps a multi-day event spanning today', () => {
    const items = buildAgenda(
      [event({ id: 'trip', title: 'Trip', start: NOW - 2 * DAY, end: NOW + 2 * DAY, allDay: true })],
      [],
    );
    expect(todayItems(items, NOW)).toHaveLength(1);
  });
});

describe('isInProgress and nextUp', () => {
  it('flags an event that has started but not ended', () => {
    const [item] = buildAgenda([event({ id: 'a', start: NOW - HOUR, end: NOW + HOUR })], []);
    expect(isInProgress(item, NOW)).toBe(true);
  });

  it('does not flag all-day events as in progress', () => {
    const [item] = buildAgenda(
      [event({ id: 'a', start: TODAY_0, end: TODAY_0 + DAY, allDay: true })],
      [],
    );
    expect(isInProgress(item, NOW)).toBe(false);
  });

  it('prefers an in-progress event over a later one', () => {
    const items = buildAgenda(
      [
        event({ id: 'running', title: 'Running', start: NOW - HOUR, end: NOW + HOUR }),
        event({ id: 'later', title: 'Later', start: NOW + 3 * HOUR, end: NOW + 4 * HOUR }),
      ],
      [],
    );
    expect(nextUp(items, NOW)!.title).toBe('Running');
  });

  it('skips finished items', () => {
    const items = buildAgenda(
      [
        event({ id: 'done', title: 'Done', start: NOW - 3 * HOUR, end: NOW - 2 * HOUR }),
        event({ id: 'soon', title: 'Soon', start: NOW + HOUR, end: NOW + 2 * HOUR }),
      ],
      [],
    );
    expect(nextUp(items, NOW)!.title).toBe('Soon');
  });

  it('skips completed tasks', () => {
    const items = buildAgenda(
      [],
      [task({ id: 'a', text: 'Ticked', done: true }, NOW + HOUR), task({ id: 'b', text: 'Open' }, NOW + 2 * HOUR)],
    );
    expect(nextUp(items, NOW)!.title).toBe('Open');
  });

  it('returns null when nothing is left', () => {
    const items = buildAgenda([event({ id: 'a', start: NOW - 3 * HOUR, end: NOW - 2 * HOUR })], []);
    expect(nextUp(items, NOW)).toBeNull();
  });
});

describe('overdueItems', () => {
  it('counts unfinished past-due tasks and never events', () => {
    const items = buildAgenda(
      [event({ id: 'past', start: NOW - 2 * HOUR, end: NOW - HOUR })],
      [
        task({ id: 'late', text: 'Late' }, NOW - HOUR),
        task({ id: 'late-done', text: 'Late but done', done: true }, NOW - HOUR),
        task({ id: 'future', text: 'Future' }, NOW + HOUR),
      ],
    );
    expect(overdueItems(items, NOW).map((i) => i.title)).toEqual(['Late']);
  });
});

describe('countAgenda', () => {
  it('reports remaining, overdue, events left, and undated', () => {
    const tasks = [
      task({ id: 'a', text: 'Due today' }, NOW + HOUR),
      task({ id: 'b', text: 'Done today', done: true }, NOW + HOUR),
      task({ id: 'c', text: 'Overdue' }, NOW - HOUR),
      task({ id: 'd', text: 'No date' }),
      task({ id: 'e', text: 'No date, done', done: true }),
      task({ id: 'f', text: 'Deleted', deleted: true }),
    ];
    const events = [
      event({ id: 'past', start: NOW - 2 * HOUR, end: NOW - HOUR }),
      event({ id: 'upcoming', start: NOW + HOUR, end: NOW + 2 * HOUR }),
    ];

    const counts = countAgenda(buildAgenda(events, tasks), tasks, NOW);
    // "Due today" and "Overdue" are both today and unfinished.
    expect(counts.remainingToday).toBe(2);
    expect(counts.overdue).toBe(1);
    expect(counts.eventsLeft).toBe(1);
    expect(counts.undated).toBe(1);
  });

  it('is all zeroes for an empty dashboard', () => {
    expect(countAgenda([], [], NOW)).toEqual({
      remainingToday: 0,
      overdue: 0,
      eventsLeft: 0,
      undated: 0,
    });
  });
});

describe('labels', () => {
  const at = (ms: number): AgendaItem => ({
    key: 'k',
    source: 'event',
    id: 'i',
    title: 't',
    start: ms,
    end: ms,
    allDay: false,
    done: false,
  });

  it('says "now" while an event is running', () => {
    const item = { ...at(NOW - HOUR), end: NOW + HOUR };
    expect(relativeLabel(item, NOW)).toBe('now');
  });

  it('counts forward in minutes, hours, then days', () => {
    expect(relativeLabel(at(NOW + 40 * MIN), NOW)).toBe('in 40m');
    expect(relativeLabel(at(NOW + 3 * HOUR), NOW)).toBe('in 3h');
    expect(relativeLabel(at(NOW + 2 * DAY), NOW)).toBe('in 2d');
  });

  it('counts backward for past items', () => {
    expect(relativeLabel(at(NOW - 40 * MIN), NOW)).toBe('40m ago');
    expect(relativeLabel(at(NOW - 2 * DAY), NOW)).toBe('2d ago');
  });

  it('labels all-day items rather than printing midnight', () => {
    expect(timeLabel({ ...at(TODAY_0), allDay: true })).toBe('All day');
    expect(timeLabel(at(TODAY_0 + 9 * HOUR))).toMatch(/9/);
  });
});
