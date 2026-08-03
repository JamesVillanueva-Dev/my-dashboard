import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  dayKey,
  fetchRange,
  type CalendarEvent,
  type CalendarOption,
  type RangeResult,
} from '../lib/gcalEvents';
import {
  addMonths,
  buildMonthGrid,
  eventsByDay,
  monthRange,
  monthTitle,
  type DayCell,
} from '../lib/calendarGrid';

/** What {@link useMonthEvents} exposes to the month view. */
export interface MonthEvents {
  /** Visible year. */
  year: number;
  /** Visible month index, 0–11. */
  month: number;
  /** "August 2026". */
  title: string;
  /** The 6×7 grid of visible days. */
  weeks: DayCell[][];
  /** Day key → that day's events, multi-day events repeated on each day. */
  byDay: Map<string, CalendarEvent[]>;
  /** `YYYY-MM-DD` of the day shown in the detail panel. */
  selectedDay: string;
  /** The selected day's events. */
  selectedEvents: CalendarEvent[];
  /** Every calendar the account has, for the event form's picker. */
  calendars: CalendarOption[];
  /** A fetch is in flight. */
  loading: boolean;
  /** Last error message, or '' if none. */
  error: string;
  /** Show the previous month. */
  prev: () => void;
  /** Show the next month. */
  next: () => void;
  /** Jump back to the current month and select today. */
  goToday: () => void;
  /** Show a day's events in the detail panel. */
  selectDay: (key: string) => void;
  /** Discard the cached month and re-fetch it. */
  refresh: () => void;
}

/**
 * Loads a month's worth of Google Calendar events for the month view.
 *
 * Deliberately separate from `useUpcomingEvents`, which owns the connection and
 * keeps its own 7-day poll running: this hook only ever reads, always silently
 * (`interactive: false`), on the token that hook already obtained. It holds no
 * `localStorage` key of its own and cannot start a consent flow.
 *
 * Because the month view is mounted only while it is open, nothing here fetches
 * until the user actually opens it.
 *
 * @param now - "Current" time, injected so "today" is the caller's clock.
 * @param weekStartsOn - Day the week starts on, 0 = Sunday.
 */
export function useMonthEvents(now: number, weekStartsOn = 0): MonthEvents {
  const [view, setView] = useState(() => {
    const d = new Date(now);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const { year, month } = view;
  const [selectedDay, setSelectedDay] = useState(() => dayKey(now));

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  /** Months already fetched this session, keyed `year-month`. */
  const cacheRef = useRef(new Map<string, RangeResult>());
  /**
   * Sequence number of the newest request. Paging quickly fires overlapping
   * fetches that can resolve out of order, and without this an earlier month's
   * response could land last and paint over the month the user is looking at.
   */
  const reqRef = useRef(0);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(
    (y: number, m: number, force: boolean) => {
      const cacheKey = `${y}-${m}`;
      if (!force) {
        const cached = cacheRef.current.get(cacheKey);
        if (cached) {
          setEvents(cached.events);
          setCalendars(cached.calendars);
          setError('');
          setLoading(false);
          return;
        }
      }

      const id = ++reqRef.current;
      setLoading(true);
      const { timeMin, timeMax } = monthRange(y, m, weekStartsOn);

      fetchRange(false, timeMin, timeMax).then(
        (next) => {
          // Worth caching even if this response lost the race — the user is
          // likely to page back to it.
          cacheRef.current.set(cacheKey, next);
          if (!aliveRef.current || id !== reqRef.current) return;
          setEvents(next.events);
          setCalendars(next.calendars);
          setError('');
          setLoading(false);
        },
        (e: unknown) => {
          if (!aliveRef.current || id !== reqRef.current) return;
          setError(e instanceof Error ? e.message : 'Could not load calendar');
          setLoading(false);
        },
      );
    },
    [weekStartsOn],
  );

  useEffect(() => {
    load(year, month, false);
  }, [year, month, load]);

  /**
   * Pages by whole months. The selection follows only when it would otherwise
   * fall outside the month on screen — paging away and back should not lose the
   * day the user was looking at.
   */
  const step = useCallback(
    (delta: number) => {
      const target = addMonths(year, month, delta);
      setView(target);
      const [sy, sm] = selectedDay.split('-').map(Number);
      if (sy !== target.year || sm - 1 !== target.month) {
        setSelectedDay(dayKey(new Date(target.year, target.month, 1).getTime()));
      }
    },
    [year, month, selectedDay],
  );

  const prev = useCallback(() => step(-1), [step]);
  const next = useCallback(() => step(1), [step]);

  const goToday = useCallback(() => {
    const d = new Date(now);
    setView({ year: d.getFullYear(), month: d.getMonth() });
    setSelectedDay(dayKey(now));
  }, [now]);

  const selectDay = useCallback((key: string) => setSelectedDay(key), []);

  /**
   * Drops every cached month and reloads the visible one. Clearing the lot
   * matters after a write: the event may have been filed on a date the user
   * typed by hand, in a month that is not the one on screen.
   */
  const refresh = useCallback(() => {
    cacheRef.current.clear();
    load(year, month, true);
  }, [year, month, load]);

  const weeks = useMemo(
    () => buildMonthGrid(year, month, weekStartsOn),
    [year, month, weekStartsOn],
  );
  const byDay = useMemo(() => eventsByDay(events), [events]);
  const selectedEvents = byDay.get(selectedDay) ?? [];

  return {
    year,
    month,
    title: monthTitle(year, month),
    weeks,
    byDay,
    selectedDay,
    selectedEvents,
    calendars,
    loading,
    error,
    prev,
    next,
    goToday,
    selectDay,
    refresh,
  };
}
