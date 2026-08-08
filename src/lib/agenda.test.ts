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

function event(overrides: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    calendarId: 'cal',
    title: 'Event',
    start: NOW + HOUR,
    end: NOW + 2 * HOUR,
    allDay: false,
    ...overrides,
  };
}

/** Formats a timestamp the way a `datetime-local` input stores it. */
function dueString(dueAt: number): string {
  const due = new Date(dueAt);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T${pad(due.getHours())}:${pad(due.getMinutes())}`;
}

/** Builds a task, due at `dueAt` — or undated when it is left out. */
function task(overrides: Partial<Reminder> & { id: string }, dueAt?: number): Reminder {
  return {
    text: 'Task',
    due: dueAt === undefined ? '' : dueString(dueAt),
    done: false,
    ...overrides,
  };
}

/** An agenda item at a single instant, for the label cases. */
const itemAt = (ms: number): AgendaItem => ({
  key: 'k',
  source: 'event',
  id: 'i',
  title: 't',
  start: ms,
  end: ms,
  allDay: false,
  done: false,
});

/** The titles of a list of agenda items, in order. */
const titlesOf = (items: AgendaItem[]) => items.map((item) => item.title);

describe('fromTask', () => {
  it('drops an undated task, which cannot be placed on a timeline', () => {
    expect(fromTask(task({ id: 'a' }))).toBeNull();
  });

  it('drops a tombstoned task awaiting a sync', () => {
    expect(fromTask(task({ id: 'a', deleted: true }, NOW))).toBeNull();
  });

  it('drops a task whose due string will not parse', () => {
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
  /** Whether an item spanning the given times falls on the day containing NOW. */
  const occursToday = (span: Partial<AgendaItem>) => occursOn({ ...itemAt(0), ...span }, NOW);

  it('includes an item starting at local midnight today', () => {
    expect(occursToday({ start: TODAY_0, end: TODAY_0 })).toBe(true);
  });

  it('excludes an item at the last instant of yesterday', () => {
    expect(occursToday({ start: TODAY_0 - 1, end: TODAY_0 - 1 })).toBe(false);
  });

  it('excludes an item at midnight starting tomorrow', () => {
    expect(occursToday({ start: TODAY_0 + DAY, end: TODAY_0 + DAY })).toBe(false);
  });

  it('includes a multi-day event that started before today and ends after', () => {
    expect(occursToday({ start: TODAY_0 - 2 * DAY, end: TODAY_0 + 2 * DAY })).toBe(true);
  });

  it('includes an all-day event covering exactly today', () => {
    expect(occursToday({ start: TODAY_0, end: TODAY_0 + DAY, allDay: true })).toBe(true);
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

    expect(titlesOf(items)).toEqual(['All day', 'Timed']);
  });

  it('lets chronology win across different days', () => {
    const items = buildAgenda(
      [
        event({
          id: 'a',
          title: 'Tomorrow all-day',
          start: TODAY_0 + DAY,
          end: TODAY_0 + 2 * DAY,
          allDay: true,
        }),
        event({
          id: 'b',
          title: 'Today timed',
          start: TODAY_0 + 9 * HOUR,
          end: TODAY_0 + 10 * HOUR,
        }),
      ],
      [],
    );

    expect(titlesOf(items)).toEqual(['Today timed', 'Tomorrow all-day']);
  });

  it('is stable for identical times, breaking ties on title then key', () => {
    const sameTime = { start: NOW, end: NOW, allDay: false, done: false, source: 'event' as const };

    const items = sortAgenda([
      { ...sameTime, key: 'b', id: 'b', title: 'Same' },
      { ...sameTime, key: 'a', id: 'a', title: 'Same' },
    ]);

    expect(items.map((item) => item.key)).toEqual(['a', 'b']);
  });
});

describe('todayItems', () => {
  it('keeps today and drops the other days', () => {
    const items = buildAgenda(
      [
        event({ id: 'today', title: 'Today', start: NOW + HOUR, end: NOW + 2 * HOUR }),
        event({ id: 'tomorrow', title: 'Tomorrow', start: NOW + DAY, end: NOW + DAY + HOUR }),
        event({ id: 'yesterday', title: 'Yesterday', start: NOW - DAY, end: NOW - DAY + HOUR }),
      ],
      [],
    );

    expect(titlesOf(todayItems(items, NOW))).toEqual(['Today']);
  });

  it('keeps a multi-day event spanning today', () => {
    const items = buildAgenda(
      [event({ id: 'trip', title: 'Trip', start: NOW - 2 * DAY, end: NOW + 2 * DAY, allDay: true })],
      [],
    );

    expect(todayItems(items, NOW)).toHaveLength(1);
  });
});

describe('isInProgress', () => {
  it('is true for an event that has started but not ended', () => {
    const [item] = buildAgenda([event({ id: 'a', start: NOW - HOUR, end: NOW + HOUR })], []);

    expect(isInProgress(item, NOW)).toBe(true);
  });

  it('is false for an all-day event, which runs all day by definition', () => {
    const [item] = buildAgenda(
      [event({ id: 'a', start: TODAY_0, end: TODAY_0 + DAY, allDay: true })],
      [],
    );

    expect(isInProgress(item, NOW)).toBe(false);
  });
});

describe('nextUp', () => {
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

  it('skips events that have already finished', () => {
    const items = buildAgenda(
      [
        event({ id: 'done', title: 'Done', start: NOW - 3 * HOUR, end: NOW - 2 * HOUR }),
        event({ id: 'soon', title: 'Soon', start: NOW + HOUR, end: NOW + 2 * HOUR }),
      ],
      [],
    );

    expect(nextUp(items, NOW)!.title).toBe('Soon');
  });

  it('skips tasks that are already ticked off', () => {
    const items = buildAgenda(
      [],
      [
        task({ id: 'a', text: 'Ticked', done: true }, NOW + HOUR),
        task({ id: 'b', text: 'Open' }, NOW + 2 * HOUR),
      ],
    );

    expect(nextUp(items, NOW)!.title).toBe('Open');
  });

  it('is null when nothing is left', () => {
    const items = buildAgenda([event({ id: 'a', start: NOW - 3 * HOUR, end: NOW - 2 * HOUR })], []);

    expect(nextUp(items, NOW)).toBeNull();
  });
});

describe('overdueItems', () => {
  it('lists unfinished past-due tasks, and never events', () => {
    const items = buildAgenda(
      [event({ id: 'past', start: NOW - 2 * HOUR, end: NOW - HOUR })],
      [
        task({ id: 'late', text: 'Late' }, NOW - HOUR),
        task({ id: 'late-done', text: 'Late but done', done: true }, NOW - HOUR),
        task({ id: 'future', text: 'Future' }, NOW + HOUR),
      ],
    );

    expect(titlesOf(overdueItems(items, NOW))).toEqual(['Late']);
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

describe('relativeLabel', () => {
  it('says "now" while an event is running', () => {
    const running = { ...itemAt(NOW - HOUR), end: NOW + HOUR };

    expect(relativeLabel(running, NOW)).toBe('now');
  });

  it('counts forward in minutes, hours, then days', () => {
    expect(relativeLabel(itemAt(NOW + 40 * MIN), NOW)).toBe('in 40m');
    expect(relativeLabel(itemAt(NOW + 3 * HOUR), NOW)).toBe('in 3h');
    expect(relativeLabel(itemAt(NOW + 2 * DAY), NOW)).toBe('in 2d');
  });

  it('counts backward for past items', () => {
    expect(relativeLabel(itemAt(NOW - 40 * MIN), NOW)).toBe('40m ago');
    expect(relativeLabel(itemAt(NOW - 2 * DAY), NOW)).toBe('2d ago');
  });
});

describe('timeLabel', () => {
  it('labels an all-day item rather than printing midnight', () => {
    expect(timeLabel({ ...itemAt(TODAY_0), allDay: true })).toBe('All day');
  });

  it('prints the clock time of a timed item', () => {
    expect(timeLabel(itemAt(TODAY_0 + 9 * HOUR))).toMatch(/9/);
  });
});
