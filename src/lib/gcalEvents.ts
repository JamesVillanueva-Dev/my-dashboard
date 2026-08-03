/**
 * Read-only view of the user's real Google Calendars (plan Phase 2).
 *
 * This is deliberately separate from `gcalSync.ts`: that module owns a single
 * app-created calendar and writes to it, while this one only ever reads, across
 * every calendar the user has selected in Google Calendar. Keeping them apart
 * means the viewing widget cannot mutate anything, whatever it does wrong.
 *
 * The `fetch` wrapper below duplicates the one in `gcalSync.ts` on purpose —
 * plan Phase 1 extracts a shared `googleApi.ts`, and doing that now would mean
 * refactoring the sync path in the same change that introduces this one.
 */

import { getAccessToken } from './googleAuth';

const API = 'https://www.googleapis.com/calendar/v3';

/** How far ahead the agenda looks. */
export const WINDOW_DAYS = 7;
/** Cap per calendar, so a busy account cannot blow up the request. */
const MAX_PER_CALENDAR = 50;

/** One upcoming event, flattened to what the widget renders. */
export interface CalendarEvent {
  /** Google's event id, unique within its calendar. */
  id: string;
  /** Which calendar it came from — part of the React key, since ids can repeat. */
  calendarId: string;
  /** Event summary, or a placeholder when Google returns none. */
  title: string;
  /** Start as epoch ms (local midnight for all-day events). */
  start: number;
  /** End as epoch ms. */
  end: number;
  /** True for date-only events, which sort above timed ones. */
  allDay: boolean;
  location?: string;
  /** Link to the event in Google Calendar. */
  htmlLink?: string;
}

/** A day's worth of events, as rendered by the agenda. */
export interface DayGroup {
  /** `YYYY-MM-DD` in local time; stable React key. */
  key: string;
  /** "Today" / "Tomorrow" / "Thu 14". */
  label: string;
  events: CalendarEvent[];
}

interface RawCalendar {
  id: string;
  summary?: string;
  selected?: boolean;
  primary?: boolean;
}

interface RawEvent {
  id?: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

async function api<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Calendar API ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Parses a `YYYY-MM-DD` all-day date as **local** midnight.
 *
 * `new Date('2026-08-03')` parses as UTC, which lands on the previous day for
 * anyone west of Greenwich — the exact bug that makes all-day events show up
 * under the wrong heading.
 */
function localMidnight(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** `YYYY-MM-DD` for a local timestamp, used to bucket events into days. */
function dayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Converts a Google event to a {@link CalendarEvent}, or `null` when it should
 * not appear: cancelled events, events the user has declined, and anything
 * without an id or start (which the API can return for malformed recurrences).
 */
export function toEvent(raw: RawEvent, calendarId: string): CalendarEvent | null {
  if (!raw.id || raw.status === 'cancelled') return null;
  const self = raw.attendees?.find((a) => a.self);
  if (self?.responseStatus === 'declined') return null;

  const allDay = !!raw.start?.date;
  const start = allDay
    ? localMidnight(raw.start!.date!)
    : raw.start?.dateTime
      ? new Date(raw.start.dateTime).getTime()
      : NaN;
  if (Number.isNaN(start)) return null;

  const end = allDay
    ? raw.end?.date
      ? localMidnight(raw.end.date)
      : start + 86_400_000
    : raw.end?.dateTime
      ? new Date(raw.end.dateTime).getTime()
      : start;

  return {
    id: raw.id,
    calendarId,
    title: raw.summary?.trim() || '(no title)',
    start,
    end,
    allDay,
    location: raw.location,
    htmlLink: raw.htmlLink,
  };
}

/**
 * Orders events for the agenda: earliest first, with all-day events pinned
 * above timed ones on the same day, and a stable title tiebreak so repeated
 * renders of identical times do not reshuffle.
 */
export function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => {
    if (a.allDay !== b.allDay) {
      // Only pin within the same day; across days, chronology wins.
      if (dayKey(a.start) === dayKey(b.start)) return a.allDay ? -1 : 1;
    }
    if (a.start !== b.start) return a.start - b.start;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Buckets sorted events into day groups with human labels.
 *
 * @param events - Events to group; sorted internally, so call order is free.
 * @param now - "Current" time, injected so tests are not clock-dependent.
 */
export function groupByDay(events: CalendarEvent[], now: number): DayGroup[] {
  const todayKey = dayKey(now);
  const tomorrowKey = dayKey(now + 86_400_000);

  const groups = new Map<string, DayGroup>();
  for (const ev of sortEvents(events)) {
    const key = dayKey(ev.start);
    let group = groups.get(key);
    if (!group) {
      const label =
        key === todayKey
          ? 'Today'
          : key === tomorrowKey
            ? 'Tomorrow'
            : new Date(ev.start).toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
              });
      group = { key, label, events: [] };
      groups.set(key, group);
    }
    group.events.push(ev);
  }
  return [...groups.values()];
}

/**
 * Fetches the next {@link WINDOW_DAYS} days of events across every selected
 * calendar.
 *
 * Calendars are queried in parallel and one failing calendar does not sink the
 * rest — a shared calendar the user has lost access to is common enough that
 * losing the whole agenda over it would be the wrong trade.
 *
 * @param interactive - `true` may open the Google consent popup, so it must come
 *   from a user gesture; `false` refreshes silently and rejects if it cannot.
 * @param now - Window start, injected for tests.
 * @returns Every visible event in the window, sorted.
 */
export async function fetchUpcoming(interactive: boolean, now: number): Promise<CalendarEvent[]> {
  const token = await getAccessToken(interactive);

  const list = await api<{ items?: RawCalendar[] }>(token, '/users/me/calendarList');
  // `selected` is what the user has ticked in Google Calendar; treat a calendar
  // with the flag absent as visible, which is how the API reports the primary.
  const calendars = (list.items ?? []).filter((c) => c.selected !== false);

  const timeMin = new Date(now).toISOString();
  const timeMax = new Date(now + WINDOW_DAYS * 86_400_000).toISOString();

  const results = await Promise.all(
    calendars.map(async (cal) => {
      const path =
        `/calendars/${encodeURIComponent(cal.id)}/events` +
        `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
        `&singleEvents=true&orderBy=startTime&maxResults=${MAX_PER_CALENDAR}`;
      try {
        const page = await api<{ items?: RawEvent[] }>(token, path);
        return (page.items ?? [])
          .map((raw) => toEvent(raw, cal.id))
          .filter((e): e is CalendarEvent => e !== null);
      } catch {
        return [];
      }
    }),
  );

  return sortEvents(results.flat());
}
