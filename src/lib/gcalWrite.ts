/**
 * Creating, editing and deleting events on the user's **own** calendars.
 *
 * This is a deliberate reversal of ADR 0002, which confined every write to the
 * app-created "Dashboard Reminders" calendar so that a bug here could not damage
 * real data. The month view is meant to work the way Google Calendar does, and
 * that is not possible from inside a sandbox. The containment that remains:
 *
 * - Writes only ever happen from an explicit user action in the event form —
 *   nothing in the polling or rendering path calls into this module.
 * - The target calendar is always named by the caller, never inferred.
 * - Calendars the user only has read access to are filtered out upstream
 *   (`CalendarOption.canWrite`), so they are never offered as a target.
 *
 * The mapping functions (`blankDraft`, `draftFromEvent`, `validateDraft`,
 * `toResource`, `needsMove`) are pure and take everything they need as
 * arguments, so the awkward parts are unit-testable without a network.
 *
 * The `fetch` wrapper below is the third copy in this codebase, after
 * `gcalSync.ts` and `gcalEvents.ts`; plan Phase 1 folds all three into a shared
 * `googleApi.ts`.
 */

import { getAccessToken } from './googleAuth';
import { dayKey, localMidnight, type CalendarEvent } from './gcalEvents';

const API = 'https://www.googleapis.com/calendar/v3';
/** Length of a new event, in minutes, before the user touches the times. */
const DEFAULT_DURATION_MIN = 60;

/** The form's working copy of an event. All fields are form-shaped strings. */
export interface EventDraft {
  /** Calendar the event lives on, or should move to. */
  calendarId: string;
  title: string;
  allDay: boolean;
  /** `YYYY-MM-DD`. */
  startDate: string;
  /** `HH:mm`, ignored when {@link allDay}. */
  startTime: string;
  /** `YYYY-MM-DD`. For all-day events this is the **last day covered**. */
  endDate: string;
  /** `HH:mm`, ignored when {@link allDay}. */
  endTime: string;
  location: string;
  description: string;
}

/** Identifies an existing event for update/delete. */
export interface EventRef {
  calendarId: string;
  eventId: string;
}

interface ApiError extends Error {
  code?: number;
}

const enc = encodeURIComponent;

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err: ApiError = new Error(`Calendar API error ${res.status}`);
    err.code = res.status;
    throw err;
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Pure mapping (unit-tested)
// ---------------------------------------------------------------------------

/** `HH:mm` for a local timestamp. */
function timeValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local epoch ms for a `YYYY-MM-DD` + `HH:mm` pair, or `NaN` if malformed. */
function instant(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  if ([y, m, d, h, min].some((n) => !Number.isFinite(n))) return NaN;
  return new Date(y, m - 1, d, h, min).getTime();
}

/** Adds whole days to a `YYYY-MM-DD` key, in local time. */
export function shiftDay(key: string, days: number): string {
  const d = new Date(localMidnight(key));
  d.setDate(d.getDate() + days);
  return dayKey(d.getTime());
}

/**
 * A new, empty event on a given day.
 *
 * Times default to the next whole hour *of the clock*, placed on the selected
 * day — adding something to next Tuesday should not default to 3am just because
 * the day has no time of its own.
 *
 * @param day - `YYYY-MM-DD` the event starts on.
 * @param calendarId - Target calendar, normally the user's primary.
 * @param now - Current time, injected for tests.
 */
export function blankDraft(day: string, calendarId: string, now: number): EventDraft {
  const nextHour = new Date(now);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);

  const start = new Date(localMidnight(day));
  start.setHours(nextHour.getHours());
  const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60_000);

  return {
    calendarId,
    title: '',
    allDay: false,
    startDate: day,
    startTime: timeValue(start.getTime()),
    // A 23:00 start pushes the end onto the following day.
    endDate: dayKey(end.getTime()),
    endTime: timeValue(end.getTime()),
    location: '',
    description: '',
  };
}

/** Times offered when an all-day event is switched to timed. */
const FALLBACK_START = '09:00';
const FALLBACK_END = '10:00';

/** Loads an existing event into the form. */
export function draftFromEvent(ev: CalendarEvent): EventDraft {
  const common = {
    calendarId: ev.calendarId,
    // `toEvent` substitutes this placeholder for an empty summary; showing it
    // would write the placeholder back as a real title on save.
    title: ev.title === '(no title)' ? '' : ev.title,
    location: ev.location ?? '',
    description: ev.description ?? '',
    startDate: dayKey(ev.start),
  };

  if (ev.allDay) {
    return {
      ...common,
      allDay: true,
      startTime: FALLBACK_START,
      // `ev.end` is local midnight of Google's *exclusive* end date; the form
      // shows the last day the event actually covers.
      endDate: dayKey(ev.end > ev.start ? ev.end - 1 : ev.start),
      endTime: FALLBACK_END,
    };
  }

  return {
    ...common,
    allDay: false,
    startTime: timeValue(ev.start),
    endDate: dayKey(ev.end),
    endTime: timeValue(ev.end),
  };
}

/** Validates a draft, returning a message to show or '' when it is fine. */
export function validateDraft(d: EventDraft): string {
  if (!d.calendarId) return 'Choose a calendar.';
  if (!d.title.trim()) return 'Give the event a title.';

  const start = d.allDay ? localMidnight(d.startDate) : instant(d.startDate, d.startTime);
  const end = d.allDay ? localMidnight(d.endDate) : instant(d.endDate, d.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Enter a valid date and time.';

  // An all-day event may start and end on the same day; a timed one may not.
  if (d.allDay ? end < start : end <= start) return 'The event must end after it starts.';
  return '';
}

/** Builds the Google event resource for a draft. */
export function toResource(d: EventDraft): Record<string, unknown> {
  const base = {
    summary: d.title.trim(),
    // Sent even when empty: on a PATCH, an absent key means "leave alone",
    // so clearing a field has to be said out loud.
    location: d.location.trim(),
    description: d.description.trim(),
  };

  if (d.allDay) {
    return {
      ...base,
      start: { date: d.startDate },
      // Google's all-day end is EXCLUSIVE — an event through the 5th ends on the 6th.
      end: { date: shiftDay(d.endDate, 1) },
    };
  }

  return {
    ...base,
    start: { dateTime: new Date(instant(d.startDate, d.startTime)).toISOString() },
    end: { dateTime: new Date(instant(d.endDate, d.endTime)).toISOString() },
  };
}

/** Whether saving this draft relocates the event to a different calendar. */
export function needsMove(from: EventRef, d: EventDraft): boolean {
  return !!d.calendarId && d.calendarId !== from.calendarId;
}

/** Turns an API failure into something worth showing a person. */
export function describeError(e: unknown): string {
  const code = (e as ApiError)?.code;
  if (code === 401) return 'Your Google session expired — reconnect and try again.';
  if (code === 403) return 'You do not have permission to change that calendar.';
  if (code === 404 || code === 410) return 'That event no longer exists.';
  if (code === 429) return 'Google is rate-limiting this account. Try again in a moment.';
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong saving that event.';
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Creates an event on `draft.calendarId`. */
export async function createEvent(draft: EventDraft): Promise<void> {
  const token = await getAccessToken(false);
  await api(token, `/calendars/${enc(draft.calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(toResource(draft)),
  });
}

/**
 * Updates an existing event, relocating it first if the calendar changed —
 * Google has a dedicated `move` endpoint for that, and patching the organiser
 * does nothing.
 *
 * For one occurrence of a recurring series (which is all this app ever reads,
 * because it lists with `singleEvents=true`) this edits that occurrence alone.
 */
export async function updateEvent(from: EventRef, draft: EventDraft): Promise<void> {
  const token = await getAccessToken(false);

  let calendarId = from.calendarId;
  if (needsMove(from, draft)) {
    await api(
      token,
      `/calendars/${enc(from.calendarId)}/events/${enc(from.eventId)}/move` +
        `?destination=${enc(draft.calendarId)}`,
      { method: 'POST' },
    );
    calendarId = draft.calendarId;
  }

  await api(token, `/calendars/${enc(calendarId)}/events/${enc(from.eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(toResource(draft)),
  });
}

/** Deletes an event. An already-deleted event counts as success. */
export async function deleteEvent(ref: EventRef): Promise<void> {
  const token = await getAccessToken(false);
  try {
    await api(token, `/calendars/${enc(ref.calendarId)}/events/${enc(ref.eventId)}`, {
      method: 'DELETE',
    });
  } catch (e) {
    const code = (e as ApiError).code;
    if (code !== 404 && code !== 410) throw e;
  }
}
