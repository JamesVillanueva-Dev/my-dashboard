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

/** Builds an all-day event from Google's shape, so the exclusive end is real. */
function allDay(id: string, start: string, endExclusive: string): CalendarEvent {
  const ev = toEvent({ id, summary: id, start: { date: start }, end: { date: endExclusive } }, 'cal');
  if (!ev) throw new Error('fixture did not convert');
  return ev;
}

/** Builds a timed event from local `YYYY-MM-DD` + hour pairs. */
function timed(id: string, day: string, startHour: number, endDay: string, endHour: number): CalendarEvent {
  const at = (d: string, h: number) => new Date(localMidnight(d) + h * 3_600_000).toISOString();
  const ev = toEvent(
    { id, summary: id, start: { dateTime: at(day, startHour) }, end: { dateTime: at(endDay, endHour) } },
    'cal',
  );
  if (!ev) throw new Error('fixture did not convert');
  return ev;
}

describe('buildMonthGrid', () => {
  it('is always 6 rows of 7 days', () => {
    for (const [y, m] of [
      [2026, 7],
      [2026, 1],
      [2024, 1],
      [2026, 10],
    ]) {
      const grid = buildMonthGrid(y, m);
      expect(grid).toHaveLength(WEEKS);
      for (const week of grid) expect(week).toHaveLength(DAYS_PER_WEEK);
    }
  });

  it('starts on the Sunday on or before the 1st', () => {
    // 1 Aug 2026 is a Saturday, so the grid opens on 26 July.
    const grid = buildMonthGrid(2026, 7);
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
    const grid = buildMonthGrid(2026, 7, 1);
    expect(grid[0][0].key).toBe('2026-07-27');
  });

  it('gives February its leap day', () => {
    const days = buildMonthGrid(2024, 1)
      .flat()
      .filter((c) => c.inMonth);
    expect(days).toHaveLength(29);
    expect(days[days.length - 1].key).toBe('2024-02-29');
  });

  it('runs consecutive days through a DST transition', () => {
    // March 2026 contains the US spring-forward; day stepping must not skip or
    // repeat a date, whatever the runner's timezone.
    const cells = buildMonthGrid(2026, 2).flat();
    for (let i = 1; i < cells.length; i++) {
      const previous = new Date(localMidnight(cells[i - 1].key));
      previous.setDate(previous.getDate() + 1);
      expect(cells[i].key).toBe(dayKey(previous.getTime()));
    }
  });

  it('marks only the target month as in-month', () => {
    const grid = buildMonthGrid(2026, 7).flat();
    expect(grid.filter((c) => c.inMonth)).toHaveLength(31);
    expect(grid.find((c) => c.key === '2026-09-01')?.inMonth).toBe(false);
  });
});

describe('monthRange', () => {
  it('covers the whole visible grid, not just the month', () => {
    const grid = buildMonthGrid(2026, 7);
    const { timeMin, timeMax } = monthRange(2026, 7);
    expect(timeMin).toBe(grid[0][0].date);
    // Exclusive end: local midnight after the last visible day.
    const lastCell = grid[WEEKS - 1][DAYS_PER_WEEK - 1];
    const afterLast = new Date(lastCell.date);
    afterLast.setDate(afterLast.getDate() + 1);
    expect(dayKey(timeMax)).toBe(dayKey(afterLast.getTime()));
  });
});

describe('eventsByDay', () => {
  it('puts a single-day timed event on its own day only', () => {
    const byDay = eventsByDay([timed('standup', '2026-08-03', 9, '2026-08-03', 10)]);
    expect([...byDay.keys()]).toEqual(['2026-08-03']);
  });

  it('repeats an all-day event across every day it covers, exclusive end aside', () => {
    // Google reports 3–5 Aug as start 08-03, end 08-06.
    const byDay = eventsByDay([allDay('conference', '2026-08-03', '2026-08-06')]);
    expect([...byDay.keys()].sort()).toEqual(['2026-08-03', '2026-08-04', '2026-08-05']);
    expect(byDay.has('2026-08-06')).toBe(false);
  });

  it('keeps a one-day all-day event on one day', () => {
    const byDay = eventsByDay([allDay('holiday', '2026-08-03', '2026-08-04')]);
    expect([...byDay.keys()]).toEqual(['2026-08-03']);
  });

  it('does not carry a timed event ending at midnight into the next day', () => {
    const byDay = eventsByDay([timed('late', '2026-08-03', 22, '2026-08-04', 0)]);
    expect([...byDay.keys()]).toEqual(['2026-08-03']);
  });

  it('spans a multi-day timed event across each day it touches', () => {
    const byDay = eventsByDay([timed('trip', '2026-08-03', 18, '2026-08-05', 9)]);
    expect([...byDay.keys()].sort()).toEqual(['2026-08-03', '2026-08-04', '2026-08-05']);
  });

  it('covers days on both sides of the visible grid', () => {
    // 26 July is the first cell of August's grid, 5 Sept the last.
    const before = allDay('before', '2026-07-24', '2026-07-28');
    const after = allDay('after', '2026-09-04', '2026-09-08');
    const byDay = eventsByDay([before, after]);

    const visible = new Set(buildMonthGrid(2026, 7).flat().map((c) => c.key));
    expect(byDay.get('2026-07-26')).toEqual([before]);
    expect(byDay.get('2026-09-05')).toEqual([after]);
    // It also buckets the days outside the grid; the view simply ignores them.
    expect(visible.has('2026-07-24')).toBe(false);
    expect(byDay.has('2026-07-24')).toBe(true);
  });

  it('pins all-day events above timed ones within a day', () => {
    const byDay = eventsByDay([
      timed('standup', '2026-08-03', 9, '2026-08-03', 10),
      allDay('conference', '2026-08-03', '2026-08-04'),
    ]);
    expect(byDay.get('2026-08-03')?.map((e) => e.id)).toEqual(['conference', 'standup']);
  });

  it('keeps a zero-length event on its own day', () => {
    const byDay = eventsByDay([timed('ping', '2026-08-03', 9, '2026-08-03', 9)]);
    expect([...byDay.keys()]).toEqual(['2026-08-03']);
  });
});

describe('addMonths', () => {
  it('rolls the year over in both directions', () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(addMonths(2026, 7, 0)).toEqual({ year: 2026, month: 7 });
  });
});

describe('weekdayLabels', () => {
  it('returns seven labels, rotated by the week start', () => {
    const sunday = weekdayLabels(0);
    const monday = weekdayLabels(1);
    expect(sunday).toHaveLength(DAYS_PER_WEEK);
    expect(monday[0].long).toBe(sunday[1].long);
    expect(monday[6].long).toBe(sunday[0].long);
  });
});
