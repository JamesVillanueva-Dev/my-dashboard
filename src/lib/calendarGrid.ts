/**
 * Pure date arithmetic for the month view.
 *
 * Everything here is a plain function of its arguments — no clock reads, no
 * fetching — so the awkward parts (DST months, leap Februaries, events that
 * straddle the edge of the grid) are unit-testable without rendering anything.
 *
 * Dates are handled in **local** time throughout, via the calendar fields of
 * `Date` rather than millisecond arithmetic: adding 86,400,000ms to a date
 * crossing a DST boundary lands on the wrong day, and this grid is built out of
 * exactly those steps.
 */

import { dayKey, sortEvents, type CalendarEvent } from './gcalEvents';

/** Rows in the grid. Fixed at 6 so the modal does not resize between months. */
export const WEEKS = 6;
/** Columns in the grid. */
export const DAYS_PER_WEEK = 7;

/**
 * Ceiling on how many days one event is expanded across. Far beyond the 42-day
 * grid, but it stops a decade-long all-day event from spinning the loop.
 */
const MAX_SPAN_DAYS = 366;

/** One cell of the month grid. */
export interface DayCell {
  /** `YYYY-MM-DD` in local time; stable React key and lookup key. */
  key: string;
  /** Local midnight, epoch ms. */
  date: number;
  /** Day of the month, 1–31. */
  day: number;
  /** False for the leading/trailing days borrowed from adjacent months. */
  inMonth: boolean;
}

/** Half-open window covering everything the grid can display. */
export interface MonthRange {
  timeMin: number;
  timeMax: number;
}

/** How far the 1st of the month sits from the start of its week. */
function leadingOffset(year: number, month: number, weekStartsOn: number): number {
  return (new Date(year, month, 1).getDay() - weekStartsOn + 7) % 7;
}

/**
 * Builds the 6×7 matrix of days shown for one month, including the leading and
 * trailing days of the neighbouring months that fill out the first and last
 * weeks.
 *
 * Always 6 rows, even when 5 would do: a grid that changes height as the user
 * pages through the year makes the whole modal jump.
 *
 * @param year - Full year, e.g. 2026.
 * @param month - Month index, 0–11 (as `Date` uses).
 * @param weekStartsOn - Day the week starts on, 0 = Sunday.
 */
export function buildMonthGrid(year: number, month: number, weekStartsOn = 0): DayCell[][] {
  const offset = leadingOffset(year, month, weekStartsOn);
  const weeks: DayCell[][] = [];

  for (let w = 0; w < WEEKS; w++) {
    const row: DayCell[] = [];
    for (let d = 0; d < DAYS_PER_WEEK; d++) {
      // Each cell is derived from the month's 1st rather than by stepping a
      // cursor, so day-overflow normalisation does the month rollover for us and
      // no DST drift can accumulate across the grid.
      const date = new Date(year, month, 1 - offset + w * DAYS_PER_WEEK + d);
      row.push({
        key: dayKey(date.getTime()),
        date: date.getTime(),
        day: date.getDate(),
        inMonth: date.getMonth() === month && date.getFullYear() === year,
      });
    }
    weeks.push(row);
  }

  return weeks;
}

/**
 * The window to fetch for a month view: the whole visible grid, not just the
 * month itself — the borrowed days from the neighbouring months show their
 * events too.
 */
export function monthRange(year: number, month: number, weekStartsOn = 0): MonthRange {
  const offset = leadingOffset(year, month, weekStartsOn);
  const first = new Date(year, month, 1 - offset);
  const afterLast = new Date(year, month, 1 - offset + WEEKS * DAYS_PER_WEEK);
  return { timeMin: first.getTime(), timeMax: afterLast.getTime() };
}

/**
 * Buckets events by day key, repeating multi-day events on every day they cover.
 *
 * The subtle part is where an event *stops*. Google reports all-day events with
 * an **exclusive** `end.date` — Aug 3–5 arrives as start `2026-08-03`, end
 * `2026-08-06` — and a timed event ending at exactly midnight belongs to the day
 * before, not to the day it touches for zero seconds. Backing the end off by one
 * millisecond resolves both cases with the same rule.
 *
 * @param events - Events to bucket; sorted internally, so call order is free.
 * @returns Day key → that day's events, all-day first (per {@link sortEvents}).
 */
export function eventsByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const byDay = new Map<string, CalendarEvent[]>();

  for (const ev of sortEvents(events)) {
    const lastKey = dayKey(ev.end > ev.start ? ev.end - 1 : ev.start);

    const cursor = new Date(ev.start);
    cursor.setHours(0, 0, 0, 0);

    for (let i = 0; i < MAX_SPAN_DAYS; i++) {
      const key = dayKey(cursor.getTime());
      const list = byDay.get(key);
      if (list) list.push(ev);
      else byDay.set(key, [ev]);

      if (key === lastKey) break;
      cursor.setDate(cursor.getDate() + 1);
      // Re-normalise: in zones whose DST changes at midnight, stepping a date
      // can land at 23:00 the previous day and stall the loop.
      cursor.setHours(0, 0, 0, 0);
    }
  }

  return byDay;
}

/** "August 2026", in the user's locale. */
export function monthTitle(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

/** Steps a year/month pair by whole months, rolling the year over. */
export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/**
 * Weekday column headings, in the user's locale, starting on `weekStartsOn`.
 *
 * Anchored to a known Sunday (4 Feb 2024) so the labels come from the same
 * formatter the rest of the UI uses rather than a hard-coded English list.
 */
export function weekdayLabels(weekStartsOn = 0): { short: string; long: string }[] {
  const KNOWN_SUNDAY = new Date(2024, 1, 4);
  return Array.from({ length: DAYS_PER_WEEK }, (_, i) => {
    const d = new Date(2024, 1, KNOWN_SUNDAY.getDate() + ((weekStartsOn + i) % DAYS_PER_WEEK));
    return {
      short: d.toLocaleDateString(undefined, { weekday: 'short' }),
      long: d.toLocaleDateString(undefined, { weekday: 'long' }),
    };
  });
}
