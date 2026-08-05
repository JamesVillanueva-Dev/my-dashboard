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

/** Google Calendar API v3 root. */
const API = 'https://www.googleapis.com/calendar/v3';

/** How far ahead the agenda looks. */
export const WINDOW_DAYS = 7;
/** Events requested per round trip. Google's own default; the max is 2500. */
const PAGE_SIZE = 250;
/**
 * Pages followed per calendar before giving up. A month across several busy
 * calendars needs more than one page, but an account with thousands of events in
 * the window should degrade to "most of them" rather than hammering the API.
 */
const MAX_PAGES = 5;

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
  /** Free text as the user typed it — a room, an address, a meeting link. */
  location?: string;
  /** The event's notes, shown in the detail view. */
  description?: string;
  /** Link to the event in Google Calendar. */
  htmlLink?: string;
  /** Name of the calendar it came from, for the month view's tooltips. */
  calendarTitle?: string;
  /** The calendar's colour (`#rrggbb`), so chips read as colour-coded. */
  calendarColor?: string;
  /** The source calendar grants write access — gates the edit UI. */
  canWrite?: boolean;
  /**
   * Set when this is one occurrence of a recurring event. Because everything is
   * read with `singleEvents=true`, editing or deleting it affects that
   * occurrence alone, which the form says out loud.
   */
  recurringEventId?: string;
}

/** The bits of a calendar list entry an event carries with it. */
export interface CalendarMeta {
  /** The calendar's display name. */
  title?: string;
  /** Its colour as `#rrggbb`. */
  color?: string;
  /** Whether the user may edit events on it. */
  canWrite?: boolean;
}

/** A calendar the user can file an event under. */
export interface CalendarOption {
  /** Google's calendar id — usually an address, and the value we send back. */
  id: string;
  /** Display name, falling back to the id when Google sends no summary. */
  title: string;
  /** Its colour as `#rrggbb`. */
  color?: string;
  /** The user's main calendar — the default target for a new event. */
  primary: boolean;
  /** `accessRole` is owner or writer. */
  canWrite: boolean;
}

/** What {@link fetchRange} returns: the events, and where they can be filed. */
export interface RangeResult {
  /** Every visible event in the window, already sorted. */
  events: CalendarEvent[];
  /** Every calendar in the list, selected or not, for the event form's picker. */
  calendars: CalendarOption[];
}

/** A day's worth of events, as rendered by the agenda. */
export interface DayGroup {
  /** `YYYY-MM-DD` in local time; stable React key. */
  key: string;
  /** "Today" / "Tomorrow" / "Thu 14". */
  label: string;
  /** That day's events, in the order the agenda lists them. */
  events: CalendarEvent[];
}

/**
 * The fields this module reads from Google's `calendarList` resource. Only a
 * subset: everything the API sends that nothing here uses is left undeclared
 * rather than mirrored, so the type says what we actually depend on.
 */
interface RawCalendar {
  /** Calendar id, used as the path segment when listing its events. */
  id: string;
  /** Display name. Absent on some shared calendars, hence the id fallback. */
  summary?: string;
  /** Ticked in the user's Google Calendar. Absent means visible — see {@link fetchRange}. */
  selected?: boolean;
  /** The account's own calendar, offered as the default target for a new event. */
  primary?: boolean;
  /** `#rrggbb`, which becomes the colour of the event's chip. */
  backgroundColor?: string;
  /** `owner` / `writer` / `reader` / `freeBusyReader` — see {@link canWrite}. */
  accessRole?: string;
}

/** The fields this module reads from Google's `events` resource. */
interface RawEvent {
  /** Absent on malformed recurrences, which {@link toEvent} drops. */
  id?: string;
  /** `cancelled` marks a deleted occurrence, which is not shown. */
  status?: string;
  /** The title. Blank or absent becomes "(no title)". */
  summary?: string;
  /** Free text — a room, an address, a meeting link. */
  location?: string;
  /** The event's notes. */
  description?: string;
  /** Permalink to the event in Google Calendar. */
  htmlLink?: string;
  /** Present on an occurrence of a recurring event; it is the series' id. */
  recurringEventId?: string;
  /** `dateTime` for a timed event, `date` for an all-day one — never both. */
  start?: { dateTime?: string; date?: string };
  /** As `start`. Exclusive, so an all-day event ends at the next midnight. */
  end?: { dateTime?: string; date?: string };
  /** Scanned for the user's own row, to hide invitations they have declined. */
  attendees?: { self?: boolean; responseStatus?: string }[];
}

/** Access roles that allow creating and editing events. */
function canWrite(cal: RawCalendar): boolean {
  return cal.accessRole === 'owner' || cal.accessRole === 'writer';
}

/**
 * Bearer-authenticated GET against the Calendar API.
 *
 * @param token - OAuth access token from {@link getAccessToken}.
 * @param path - Path below {@link API}, including any query string. Callers
 *   encode their own path segments — calendar ids are email addresses.
 * @returns The parsed JSON body.
 * @throws If the response status is not 2xx. The status is in the message, and
 *   {@link fetchRange} uses that to drop one unreadable calendar rather than
 *   failing the whole agenda.
 */
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
export function localMidnight(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** `YYYY-MM-DD` for a local timestamp, used to bucket events into days. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Converts a Google event to a {@link CalendarEvent}, or `null` when it should
 * not appear: cancelled events, events the user has declined, and anything
 * without an id or start (which the API can return for malformed recurrences).
 *
 * @param calendar - Name and colour of the source calendar, carried onto the
 *   event so the month grid can colour-code chips without a second lookup.
 */
export function toEvent(
  raw: RawEvent,
  calendarId: string,
  calendar?: CalendarMeta,
): CalendarEvent | null {
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
    description: raw.description,
    htmlLink: raw.htmlLink,
    recurringEventId: raw.recurringEventId,
    calendarTitle: calendar?.title,
    calendarColor: calendar?.color,
    canWrite: calendar?.canWrite,
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
 * Reads one calendar's events in a window, following `nextPageToken`.
 *
 * A week rarely needs a second page; a month across several calendars regularly
 * does, and without this the tail of the month would silently go missing.
 */
async function fetchCalendar(
  token: string,
  cal: RawCalendar,
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[]> {
  const meta: CalendarMeta = {
    title: cal.summary,
    color: cal.backgroundColor,
    canWrite: canWrite(cal),
  };
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const path =
      `/calendars/${encodeURIComponent(cal.id)}/events` +
      `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
      `&singleEvents=true&orderBy=startTime&maxResults=${PAGE_SIZE}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');

    const res = await api<{ items?: RawEvent[]; nextPageToken?: string }>(token, path);
    for (const raw of res.items ?? []) {
      const ev = toEvent(raw, cal.id, meta);
      if (ev) events.push(ev);
    }
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }

  return events;
}

/**
 * Fetches every visible event between two instants, across every selected
 * calendar.
 *
 * Calendars are queried in parallel and one failing calendar does not sink the
 * rest — a shared calendar the user has lost access to is common enough that
 * losing the whole agenda over it would be the wrong trade.
 *
 * @param interactive - `true` may open the Google consent popup, so it must come
 *   from a user gesture; `false` refreshes silently and rejects if it cannot.
 * @param timeMin - Window start, epoch ms.
 * @param timeMax - Window end, epoch ms (exclusive as far as Google is concerned).
 * @returns The window's events, sorted, plus the full calendar list — the event
 *   form needs somewhere to file a new event, and this request has already paid
 *   for that lookup.
 */
export async function fetchRange(
  interactive: boolean,
  timeMin: number,
  timeMax: number,
): Promise<RangeResult> {
  const token = await getAccessToken(interactive);

  const list = await api<{ items?: RawCalendar[] }>(token, '/users/me/calendarList');
  const all = list.items ?? [];
  // `selected` is what the user has ticked in Google Calendar; treat a calendar
  // with the flag absent as visible, which is how the API reports the primary.
  const visible = all.filter((c) => c.selected !== false);

  const min = new Date(timeMin).toISOString();
  const max = new Date(timeMax).toISOString();

  const results = await Promise.all(
    visible.map(async (cal) => {
      try {
        return await fetchCalendar(token, cal, min, max);
      } catch {
        return [];
      }
    }),
  );

  return {
    events: sortEvents(results.flat()),
    calendars: all.map((c) => ({
      id: c.id,
      title: c.summary ?? c.id,
      color: c.backgroundColor,
      primary: !!c.primary,
      canWrite: canWrite(c),
    })),
  };
}

/**
 * Fetches the next {@link WINDOW_DAYS} days of events — what the agenda widget
 * shows.
 *
 * @param now - Window start, injected for tests.
 */
export async function fetchUpcoming(interactive: boolean, now: number): Promise<CalendarEvent[]> {
  const { events } = await fetchRange(interactive, now, now + WINDOW_DAYS * 86_400_000);
  return events;
}
