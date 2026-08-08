import { describe, it, expect } from 'vitest';
import {
  DAYS_PER_WEEK,
  WEEKS,
  addMonths,
  buildMonthGrid,
  eventsByDay,
  monthRange,
  weekdayLabels,
} from './calendarGrid';
import { dayKey, localMidnight, toEvent, type CalendarEvent } from './gcalEvents';

/** August 2026, the month most cases below are written against. */
const AUGUST_2026 = [2026, 7] as const;

/** Week starts, as `buildMonthGrid` takes them. */
const SUNDAY = 0;
const MONDAY = 1;

/** Builds an all-day event from Google's shape, so the exclusive end is real. */
function allDay(id: string, start: string, endExclusive: string): CalendarEvent {
  const event = toEvent(
    { id, summary: id, start: { date: start }, end: { date: endExclusive } },
    'cal',
  );
  if (!event) throw new Error('fixture did not convert');
  return event;
}

/** Builds a timed event from local `YYYY-MM-DD` + hour pairs. */
function timed(
  id: string,
  startDay: string,
  startHour: number,
  endDay: string,
  endHour: number,
): CalendarEvent {
  const at = (day: string, hour: number) =>
    new Date(localMidnight(day) + hour * 3_600_000).toISOString();
  const event = toEvent(
    {
      id,
      summary: id,
      start: { dateTime: at(startDay, startHour) },
      end: { dateTime: at(endDay, endHour) },
    },
    'cal',
  );
  if (!event) throw new Error('fixture did not convert');
  return event;
}

/** The days an event was bucketed under, sorted. */
const daysWithEvents = (byDay: Map<string, CalendarEvent[]>) => [...byDay.keys()].sort();

describe('buildMonthGrid', () => {
  it('is always 6 rows of 7 days', () => {
    for (const [year, month] of [
      [2026, 7],
      [2026, 1],
      [2024, 1],
      [2026, 10],
    ]) {
      const grid = buildMonthGrid(year, month);

      expect(grid).toHaveLength(WEEKS);
      for (const week of grid) expect(week).toHaveLength(DAYS_PER_WEEK);
    }
  });

  it('starts on the Sunday on or before the 1st', () => {
    // 1 Aug 2026 is a Saturday, so the grid opens on 26 July.
    const grid = buildMonthGrid(...AUGUST_2026);

    expect(grid[0][0].key).toBe('2026-07-26');
    expect(grid[0][0].inMonth).toBe(false);
    expect(grid[0][6].key).toBe('2026-08-01');
    expect(grid[0][6].inMonth).toBe(true);
  });

  it('needs no leading days when the month starts on the week start', () => {
    // 1 Feb 2026 is a Sunday.
    const grid = buildMonthGrid(2026, 1);

    expect(grid[0][0].key).toBe('2026-02-01');
    expect(grid[0][0].inMonth).toBe(true);
  });

  it('honours a Monday week start', () => {
    // 1 Aug 2026 is a Saturday; a Monday-first grid opens on 27 July.
    const grid = buildMonthGrid(...AUGUST_2026, MONDAY);

    expect(grid[0][0].key).toBe('2026-07-27');
  });

  it('gives February its leap day', () => {
    const daysInMonth = buildMonthGrid(2024, 1)
      .flat()
      .filter((cell) => cell.inMonth);

    expect(daysInMonth).toHaveLength(29);
    expect(daysInMonth[daysInMonth.length - 1].key).toBe('2024-02-29');
  });

  it('runs consecutive days through a DST transition', () => {
    // March 2026 contains the US spring-forward; day stepping must not skip or
    // repeat a date, whatever the runner's timezone.
    const cells = buildMonthGrid(2026, 2).flat();

    for (let index = 1; index < cells.length; index++) {
      const dayAfterPrevious = new Date(localMidnight(cells[index - 1].key));
      dayAfterPrevious.setDate(dayAfterPrevious.getDate() + 1);

      expect(cells[index].key).toBe(dayKey(dayAfterPrevious.getTime()));
    }
  });

  it('marks only the target month as in-month', () => {
    const cells = buildMonthGrid(...AUGUST_2026).flat();

    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(31);
    expect(cells.find((cell) => cell.key === '2026-09-01')?.inMonth).toBe(false);
  });
});

describe('monthRange', () => {
  it('covers the whole visible grid, not just the month', () => {
    const grid = buildMonthGrid(...AUGUST_2026);

    const { timeMin, timeMax } = monthRange(...AUGUST_2026);

    expect(timeMin).toBe(grid[0][0].date);
    // Exclusive end: local midnight after the last visible day.
    const lastCell = grid[WEEKS - 1][DAYS_PER_WEEK - 1];
    const dayAfterLastCell = new Date(lastCell.date);
    dayAfterLastCell.setDate(dayAfterLastCell.getDate() + 1);
    expect(dayKey(timeMax)).toBe(dayKey(dayAfterLastCell.getTime()));
  });
});

describe('eventsByDay', () => {
  it('puts a single-day timed event on its own day only', () => {
    const byDay = eventsByDay([timed('standup', '2026-08-03', 9, '2026-08-03', 10)]);

    expect(daysWithEvents(byDay)).toEqual(['2026-08-03']);
  });

  it('repeats an all-day event across every day it covers', () => {
    // Google reports 3–5 Aug as start 08-03, end 08-06.
    const byDay = eventsByDay([allDay('conference', '2026-08-03', '2026-08-06')]);

    expect(daysWithEvents(byDay)).toEqual(['2026-08-03', '2026-08-04', '2026-08-05']);
  });

  it('leaves the exclusive end day of an all-day event empty', () => {
    const byDay = eventsByDay([allDay('conference', '2026-08-03', '2026-08-06')]);

    expect(byDay.has('2026-08-06')).toBe(false);
  });

  it('keeps a one-day all-day event on one day', () => {
    const byDay = eventsByDay([allDay('holiday', '2026-08-03', '2026-08-04')]);

    expect(daysWithEvents(byDay)).toEqual(['2026-08-03']);
  });

  it('does not carry a timed event ending at midnight into the next day', () => {
    const byDay = eventsByDay([timed('late', '2026-08-03', 22, '2026-08-04', 0)]);

    expect(daysWithEvents(byDay)).toEqual(['2026-08-03']);
  });

  it('spans a multi-day timed event across each day it touches', () => {
    const byDay = eventsByDay([timed('trip', '2026-08-03', 18, '2026-08-05', 9)]);

    expect(daysWithEvents(byDay)).toEqual(['2026-08-03', '2026-08-04', '2026-08-05']);
  });

  it('covers the days on both sides of the visible grid', () => {
    // 26 July is the first cell of August's grid, 5 Sept the last.
    const beforeGrid = allDay('before', '2026-07-24', '2026-07-28');
    const afterGrid = allDay('after', '2026-09-04', '2026-09-08');

    const byDay = eventsByDay([beforeGrid, afterGrid]);

    expect(byDay.get('2026-07-26')).toEqual([beforeGrid]);
    expect(byDay.get('2026-09-05')).toEqual([afterGrid]);
  });

  it('also buckets days outside the grid, which the view simply ignores', () => {
    const byDay = eventsByDay([allDay('before', '2026-07-24', '2026-07-28')]);

    const visibleDays = new Set(
      buildMonthGrid(...AUGUST_2026)
        .flat()
        .map((cell) => cell.key),
    );
    expect(visibleDays.has('2026-07-24')).toBe(false);
    expect(byDay.has('2026-07-24')).toBe(true);
  });

  it('pins all-day events above timed ones within a day', () => {
    const byDay = eventsByDay([
      timed('standup', '2026-08-03', 9, '2026-08-03', 10),
      allDay('conference', '2026-08-03', '2026-08-04'),
    ]);

    expect(byDay.get('2026-08-03')?.map((event) => event.id)).toEqual(['conference', 'standup']);
  });

  it('keeps a zero-length event on its own day', () => {
    const byDay = eventsByDay([timed('ping', '2026-08-03', 9, '2026-08-03', 9)]);

    expect(daysWithEvents(byDay)).toEqual(['2026-08-03']);
  });
});

describe('addMonths', () => {
  it('rolls forward into the next year', () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
  });

  it('rolls back into the previous year', () => {
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });

  it('stays put for a step of zero', () => {
    expect(addMonths(2026, 7, 0)).toEqual({ year: 2026, month: 7 });
  });
});

describe('weekdayLabels', () => {
  it('returns one label per day of the week', () => {
    expect(weekdayLabels(SUNDAY)).toHaveLength(DAYS_PER_WEEK);
  });

  it('rotates the labels by the week start', () => {
    const sundayFirst = weekdayLabels(SUNDAY);
    const mondayFirst = weekdayLabels(MONDAY);

    expect(mondayFirst[0].long).toBe(sundayFirst[1].long);
    expect(mondayFirst[6].long).toBe(sundayFirst[0].long);
  });
});
