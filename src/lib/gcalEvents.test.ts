import { describe, it, expect, vi } from 'vitest';
import {
  WINDOW_DAYS,
  dayKey,
  fetchRange,
  fetchUpcoming,
  groupByDay,
  localMidnight,
  sortEvents,
  toEvent,
  type CalendarEvent,
} from './gcalEvents';

vi.mock('./googleAuth', () => ({
  hasGoogleClientId: () => true,
  getAccessToken: vi.fn(() => Promise.resolve('test-token')),
  clearAccessToken: vi.fn(),
}));

/** A stubbed response for one API call. */
interface Reply {
  ok?: boolean;
  status?: number;
  body?: unknown;
}

/** Replaces `fetch` with a router over the request URL. */
function stubFetch(handler: (url: string) => Reply) {
  // Typed as `fetch` itself so recorded calls carry the request init too.
  const mock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    (input) => {
      const reply = handler(String(input));
      return Promise.resolve({
        ok: reply.ok ?? true,
        status: reply.status ?? 200,
        json: () => Promise.resolve(reply.body ?? {}),
      } as Response);
    },
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** An event fixture as Google returns it, timed unless overridden. */
function raw(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    summary: 'Standup',
    start: { dateTime: '2026-08-03T09:00:00Z' },
    end: { dateTime: '2026-08-03T09:15:00Z' },
    ...over,
  };
}

/** Converts a fixture, failing the test rather than returning null. */
function convert(over: Record<string, unknown> = {}, calendarId = 'cal-1'): CalendarEvent {
  const ev = toEvent(raw(over), calendarId);
  if (!ev) throw new Error('fixture did not convert');
  return ev;
}

describe('localMidnight', () => {
  it('parses an all-day date in local time, not UTC', () => {
    const ms = localMidnight('2026-08-03');
    const d = new Date(ms);
    // The bug this guards against is the date landing on the 2nd west of Greenwich.
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(3);
    expect(d.getHours()).toBe(0);
  });
});

describe('dayKey', () => {
  it('formats a local timestamp as YYYY-MM-DD', () => {
    expect(dayKey(new Date(2026, 7, 3, 13, 45).getTime())).toBe('2026-08-03');
  });

  it('zero-pads single-digit months and days', () => {
    expect(dayKey(new Date(2026, 0, 9, 23, 59).getTime())).toBe('2026-01-09');
  });

  it('round-trips with localMidnight', () => {
    expect(dayKey(localMidnight('2026-12-31'))).toBe('2026-12-31');
  });
});

describe('toEvent', () => {
  it('flattens a timed event', () => {
    expect(convert()).toMatchObject({
      id: 'e1',
      calendarId: 'cal-1',
      title: 'Standup',
      allDay: false,
      start: Date.parse('2026-08-03T09:00:00Z'),
      end: Date.parse('2026-08-03T09:15:00Z'),
    });
  });

  it('treats a date-only event as all-day at local midnight', () => {
    const ev = convert({ start: { date: '2026-08-03' }, end: { date: '2026-08-04' } });
    expect(ev.allDay).toBe(true);
    expect(ev.start).toBe(localMidnight('2026-08-03'));
    expect(ev.end).toBe(localMidnight('2026-08-04'));
  });

  it('gives an all-day event with no end a full day', () => {
    const ev = convert({ start: { date: '2026-08-03' }, end: undefined });
    expect(ev.end - ev.start).toBe(86_400_000);
  });

  it('falls back to a zero-length event when a timed event has no end', () => {
    const ev = convert({ end: undefined });
    expect(ev.end).toBe(ev.start);
  });

  it('substitutes a placeholder for a missing or blank title', () => {
    expect(convert({ summary: undefined }).title).toBe('(no title)');
    expect(convert({ summary: '   ' }).title).toBe('(no title)');
  });

  it('trims the title', () => {
    expect(convert({ summary: '  Standup  ' }).title).toBe('Standup');
  });

  it('drops a cancelled event', () => {
    expect(toEvent(raw({ status: 'cancelled' }), 'cal-1')).toBeNull();
  });

  it('drops an event the user has declined', () => {
    const attendees = [{ self: true, responseStatus: 'declined' }];
    expect(toEvent(raw({ attendees }), 'cal-1')).toBeNull();
  });

  it('keeps an event someone else declined', () => {
    const attendees = [
      { self: false, responseStatus: 'declined' },
      { self: true, responseStatus: 'accepted' },
    ];
    expect(toEvent(raw({ attendees }), 'cal-1')).not.toBeNull();
  });

  it('drops an event with no id', () => {
    expect(toEvent(raw({ id: undefined }), 'cal-1')).toBeNull();
  });

  it('drops an event with no usable start', () => {
    expect(toEvent(raw({ start: undefined }), 'cal-1')).toBeNull();
    expect(toEvent(raw({ start: { dateTime: 'not a date' } }), 'cal-1')).toBeNull();
  });

  it('carries the source calendar’s name, colour, and writability onto the event', () => {
    const ev = toEvent(raw(), 'cal-1', { title: 'Work', color: '#ff0000', canWrite: true });
    expect(ev).toMatchObject({ calendarTitle: 'Work', calendarColor: '#ff0000', canWrite: true });
  });

  it('marks an occurrence of a recurring series', () => {
    expect(convert({ recurringEventId: 'series-1' }).recurringEventId).toBe('series-1');
  });
});

describe('sortEvents', () => {
  it('orders by start time', () => {
    const late = convert({ id: 'late', start: { dateTime: '2026-08-03T15:00:00Z' } });
    const early = convert({ id: 'early', start: { dateTime: '2026-08-03T08:00:00Z' } });
    expect(sortEvents([late, early]).map((e) => e.id)).toEqual(['early', 'late']);
  });

  it('pins an all-day event above timed events on the same day', () => {
    const day = dayKey(new Date(2026, 7, 3, 12).getTime());
    const timed = convert({
      id: 'timed',
      start: { dateTime: new Date(2026, 7, 3, 8).toISOString() },
    });
    const allDay = convert({ id: 'allday', start: { date: day }, end: { date: day } });

    expect(sortEvents([timed, allDay]).map((e) => e.id)).toEqual(['allday', 'timed']);
  });

  it('lets chronology win across days, so all-day does not jump ahead', () => {
    const timedToday = convert({
      id: 'today',
      start: { dateTime: new Date(2026, 7, 3, 8).toISOString() },
    });
    const allDayTomorrow = convert({
      id: 'tomorrow',
      start: { date: '2026-08-04' },
      end: { date: '2026-08-05' },
    });

    expect(sortEvents([allDayTomorrow, timedToday]).map((e) => e.id)).toEqual(['today', 'tomorrow']);
  });

  it('breaks ties on title so repeated renders do not reshuffle', () => {
    const b = convert({ id: 'b', summary: 'Beta' });
    const a = convert({ id: 'a', summary: 'Alpha' });
    expect(sortEvents([b, a]).map((e) => e.title)).toEqual(['Alpha', 'Beta']);
  });

  it('does not mutate the input array', () => {
    const late = convert({ id: 'late', start: { dateTime: '2026-08-03T15:00:00Z' } });
    const early = convert({ id: 'early', start: { dateTime: '2026-08-03T08:00:00Z' } });
    const input = [late, early];

    sortEvents(input);

    expect(input.map((e) => e.id)).toEqual(['late', 'early']);
  });
});

describe('groupByDay', () => {
  const now = new Date(2026, 7, 3, 10).getTime();

  it('labels the first two days in words and the rest by weekday', () => {
    const today = convert({
      id: 'a',
      start: { dateTime: new Date(2026, 7, 3, 14).toISOString() },
    });
    const tomorrow = convert({
      id: 'b',
      start: { dateTime: new Date(2026, 7, 4, 9).toISOString() },
    });
    const later = convert({
      id: 'c',
      start: { dateTime: new Date(2026, 7, 6, 9).toISOString() },
    });

    const groups = groupByDay([later, tomorrow, today], now);

    expect(groups.map((g) => g.key)).toEqual(['2026-08-03', '2026-08-04', '2026-08-06']);
    expect(groups[0].label).toBe('Today');
    expect(groups[1].label).toBe('Tomorrow');
    expect(groups[2].label).not.toBe('Tomorrow');
    expect(groups[2].label).toBeTruthy();
  });

  it('collects a day’s events into one group, sorted', () => {
    const later = convert({
      id: 'later',
      start: { dateTime: new Date(2026, 7, 3, 16).toISOString() },
    });
    const earlier = convert({
      id: 'earlier',
      start: { dateTime: new Date(2026, 7, 3, 11).toISOString() },
    });

    const groups = groupByDay([later, earlier], now);

    expect(groups).toHaveLength(1);
    expect(groups[0].events.map((e) => e.id)).toEqual(['earlier', 'later']);
  });

  it('returns nothing for an empty list', () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe('fetchRange', () => {
  const MIN = new Date(2026, 7, 1).getTime();
  const MAX = new Date(2026, 8, 1).getTime();

  /** Routes the calendar list and each calendar's events. */
  function stubCalendars(
    calendars: Record<string, unknown>[],
    events: (calendarId: string) => Reply,
  ) {
    return stubFetch((url) => {
      if (url.includes('/users/me/calendarList')) return { body: { items: calendars } };
      const id = decodeURIComponent(url.split('/calendars/')[1].split('/events')[0]);
      return events(id);
    });
  }

  it('reads every visible calendar and merges the results in order', async () => {
    stubCalendars(
      [
        { id: 'work', summary: 'Work', accessRole: 'owner', backgroundColor: '#f00' },
        { id: 'home', summary: 'Home', accessRole: 'reader' },
      ],
      (id) => ({
        body: {
          items: [
            id === 'work'
              ? raw({ id: 'w1', start: { dateTime: '2026-08-03T15:00:00Z' } })
              : raw({ id: 'h1', start: { dateTime: '2026-08-03T08:00:00Z' } }),
          ],
        },
      }),
    );

    const { events } = await fetchRange(false, MIN, MAX);

    expect(events.map((e) => e.id)).toEqual(['h1', 'w1']);
    expect(events.find((e) => e.id === 'w1')).toMatchObject({
      calendarTitle: 'Work',
      calendarColor: '#f00',
      canWrite: true,
    });
    // A reader-role calendar contributes events but cannot be written to.
    expect(events.find((e) => e.id === 'h1')?.canWrite).toBe(false);
  });

  it('skips calendars the user has unticked in Google Calendar', async () => {
    const fetchMock = stubCalendars(
      [
        { id: 'work', summary: 'Work', accessRole: 'owner' },
        { id: 'hidden', summary: 'Hidden', selected: false, accessRole: 'owner' },
      ],
      () => ({ body: { items: [] } }),
    );

    await fetchRange(false, MIN, MAX);

    const queried = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(queried.some((u) => u.includes('/calendars/work/events'))).toBe(true);
    expect(queried.some((u) => u.includes('/calendars/hidden/events'))).toBe(false);
  });

  it('treats a calendar with no `selected` flag as visible', async () => {
    stubCalendars([{ id: 'primary', summary: 'Me', primary: true, accessRole: 'owner' }], () => ({
      body: { items: [raw()] },
    }));

    const { events } = await fetchRange(false, MIN, MAX);

    expect(events).toHaveLength(1);
  });

  it('returns the full calendar list, including unticked ones, for the event form', async () => {
    stubCalendars(
      [
        { id: 'primary', summary: 'Me', primary: true, accessRole: 'owner' },
        { id: 'hidden', summary: 'Hidden', selected: false, accessRole: 'reader' },
      ],
      () => ({ body: { items: [] } }),
    );

    const { calendars } = await fetchRange(false, MIN, MAX);

    expect(calendars).toEqual([
      { id: 'primary', title: 'Me', color: undefined, primary: true, canWrite: true },
      { id: 'hidden', title: 'Hidden', color: undefined, primary: false, canWrite: false },
    ]);
  });

  it('falls back to the id when a calendar has no name', async () => {
    stubCalendars([{ id: 'no-name@group.calendar.google.com', accessRole: 'owner' }], () => ({
      body: { items: [] },
    }));

    const { calendars } = await fetchRange(false, MIN, MAX);

    expect(calendars[0].title).toBe('no-name@group.calendar.google.com');
  });

  it('keeps the other calendars when one fails', async () => {
    stubCalendars(
      [
        { id: 'good', summary: 'Good', accessRole: 'owner' },
        { id: 'lost-access', summary: 'Shared', accessRole: 'reader' },
      ],
      (id) =>
        id === 'lost-access' ? { ok: false, status: 403 } : { body: { items: [raw({ id: 'ok' })] } },
    );

    const { events } = await fetchRange(false, MIN, MAX);

    expect(events.map((e) => e.id)).toEqual(['ok']);
  });

  it('follows nextPageToken so a busy month is not truncated', async () => {
    let page = 0;
    stubCalendars([{ id: 'work', summary: 'Work', accessRole: 'owner' }], () => {
      page++;
      return {
        body: {
          items: [raw({ id: `p${page}` })],
          nextPageToken: page < 3 ? `token-${page}` : undefined,
        },
      };
    });

    const { events } = await fetchRange(false, MIN, MAX);

    expect(events.map((e) => e.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('stops after the page cap rather than paging forever', async () => {
    let page = 0;
    stubCalendars([{ id: 'work', summary: 'Work', accessRole: 'owner' }], () => {
      page++;
      return { body: { items: [raw({ id: `p${page}` })], nextPageToken: 'always-more' } };
    });

    const { events } = await fetchRange(false, MIN, MAX);

    expect(events).toHaveLength(5);
  });

  it('sends the access token and the window as ISO instants', async () => {
    const fetchMock = stubCalendars([{ id: 'work', accessRole: 'owner' }], () => ({
      body: { items: [] },
    }));

    await fetchRange(false, MIN, MAX);

    const [, init] = fetchMock.mock.calls[0];
    expect(init!.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    const eventsUrl = String(fetchMock.mock.calls[1][0]);
    expect(eventsUrl).toContain(`timeMin=${encodeURIComponent(new Date(MIN).toISOString())}`);
    expect(eventsUrl).toContain(`timeMax=${encodeURIComponent(new Date(MAX).toISOString())}`);
    // Recurrences are expanded server-side, so each occurrence is its own event.
    expect(eventsUrl).toContain('singleEvents=true');
  });

  it('rejects when the calendar list itself fails', async () => {
    stubFetch(() => ({ ok: false, status: 401 }));

    await expect(fetchRange(false, MIN, MAX)).rejects.toThrow('Calendar API 401');
  });

  it('copes with a calendar list that has no items', async () => {
    stubFetch(() => ({ body: {} }));

    await expect(fetchRange(false, MIN, MAX)).resolves.toEqual({ events: [], calendars: [] });
  });
});

describe('fetchUpcoming', () => {
  it('asks for a window of WINDOW_DAYS starting now', async () => {
    const now = new Date(2026, 7, 3, 10).getTime();
    const fetchMock = stubFetch((url) =>
      url.includes('/users/me/calendarList')
        ? { body: { items: [{ id: 'work', accessRole: 'owner' }] } }
        : { body: { items: [raw()] } },
    );

    const events = await fetchUpcoming(false, now);

    expect(events).toHaveLength(1);
    const eventsUrl = String(fetchMock.mock.calls[1][0]);
    expect(eventsUrl).toContain(`timeMin=${encodeURIComponent(new Date(now).toISOString())}`);
    expect(eventsUrl).toContain(
      `timeMax=${encodeURIComponent(new Date(now + WINDOW_DAYS * 86_400_000).toISOString())}`,
    );
  });
});
