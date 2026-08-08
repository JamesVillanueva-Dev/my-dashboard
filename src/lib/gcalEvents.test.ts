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

const DAY_MS = 86_400_000;

/** `fetchRange`'s first argument: whether to prompt for consent. */
const BACKGROUND = false;

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
function raw(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    summary: 'Standup',
    start: { dateTime: '2026-08-03T09:00:00Z' },
    end: { dateTime: '2026-08-03T09:15:00Z' },
    ...overrides,
  };
}

/** Converts a fixture, failing the test rather than returning null. */
function convert(overrides: Record<string, unknown> = {}, calendarId = 'cal-1'): CalendarEvent {
  const event = toEvent(raw(overrides), calendarId);
  if (!event) throw new Error('fixture did not convert');
  return event;
}

/** A timed event on 3 August at the given local hour. */
const eventAtHour = (id: string, hour: number, day = 3) =>
  convert({ id, start: { dateTime: new Date(2026, 7, day, hour).toISOString() } });

/** The ids of a list of events, in order. */
const idsOf = (events: CalendarEvent[]) => events.map((event) => event.id);

describe('localMidnight', () => {
  it('parses an all-day date in local time, not UTC', () => {
    const midnight = new Date(localMidnight('2026-08-03'));

    // The bug this guards against is the date landing on the 2nd west of Greenwich.
    expect(midnight.getFullYear()).toBe(2026);
    expect(midnight.getMonth()).toBe(7);
    expect(midnight.getDate()).toBe(3);
    expect(midnight.getHours()).toBe(0);
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
    const event = convert({ start: { date: '2026-08-03' }, end: { date: '2026-08-04' } });

    expect(event.allDay).toBe(true);
    expect(event.start).toBe(localMidnight('2026-08-03'));
    expect(event.end).toBe(localMidnight('2026-08-04'));
  });

  it('gives an all-day event with no end a full day', () => {
    const event = convert({ start: { date: '2026-08-03' }, end: undefined });

    expect(event.end - event.start).toBe(DAY_MS);
  });

  it('gives a timed event with no end zero length', () => {
    const event = convert({ end: undefined });

    expect(event.end).toBe(event.start);
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
    const event = toEvent(raw(), 'cal-1', { title: 'Work', color: '#ff0000', canWrite: true });

    expect(event).toMatchObject({
      calendarTitle: 'Work',
      calendarColor: '#ff0000',
      canWrite: true,
    });
  });

  it('marks an occurrence of a recurring series', () => {
    expect(convert({ recurringEventId: 'series-1' }).recurringEventId).toBe('series-1');
  });
});

describe('sortEvents', () => {
  it('orders by start time', () => {
    const late = eventAtHour('late', 15);
    const early = eventAtHour('early', 8);

    expect(idsOf(sortEvents([late, early]))).toEqual(['early', 'late']);
  });

  it('pins an all-day event above timed events on the same day', () => {
    const day = dayKey(new Date(2026, 7, 3, 12).getTime());
    const timed = eventAtHour('timed', 8);
    const allDay = convert({ id: 'allday', start: { date: day }, end: { date: day } });

    expect(idsOf(sortEvents([timed, allDay]))).toEqual(['allday', 'timed']);
  });

  it('lets chronology win across days, so all-day does not jump ahead', () => {
    const timedToday = eventAtHour('today', 8);
    const allDayTomorrow = convert({
      id: 'tomorrow',
      start: { date: '2026-08-04' },
      end: { date: '2026-08-05' },
    });

    expect(idsOf(sortEvents([allDayTomorrow, timedToday]))).toEqual(['today', 'tomorrow']);
  });

  it('breaks ties on title so repeated renders do not reshuffle', () => {
    const beta = convert({ id: 'b', summary: 'Beta' });
    const alpha = convert({ id: 'a', summary: 'Alpha' });

    expect(sortEvents([beta, alpha]).map((event) => event.title)).toEqual(['Alpha', 'Beta']);
  });

  it('does not mutate the input array', () => {
    const unsorted = [eventAtHour('late', 15), eventAtHour('early', 8)];

    sortEvents(unsorted);

    expect(idsOf(unsorted)).toEqual(['late', 'early']);
  });
});

describe('groupByDay', () => {
  /** 3 August 2026, 10:00 local. */
  const now = new Date(2026, 7, 3, 10).getTime();

  it('groups the events by the day they fall on', () => {
    const groups = groupByDay(
      [eventAtHour('c', 9, 6), eventAtHour('b', 9, 4), eventAtHour('a', 14, 3)],
      now,
    );

    expect(groups.map((group) => group.key)).toEqual(['2026-08-03', '2026-08-04', '2026-08-06']);
  });

  it('labels the first two days in words', () => {
    const groups = groupByDay([eventAtHour('a', 14, 3), eventAtHour('b', 9, 4)], now);

    expect(groups[0].label).toBe('Today');
    expect(groups[1].label).toBe('Tomorrow');
  });

  it('labels the days after that by weekday', () => {
    const groups = groupByDay([eventAtHour('c', 9, 6)], now);

    expect(groups[0].label).toBeTruthy();
    expect(groups[0].label).not.toBe('Tomorrow');
  });

  it('collects a day’s events into one group, sorted', () => {
    const groups = groupByDay([eventAtHour('later', 16), eventAtHour('earlier', 11)], now);

    expect(groups).toHaveLength(1);
    expect(idsOf(groups[0].events)).toEqual(['earlier', 'later']);
  });

  it('returns nothing for an empty list', () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe('fetchRange', () => {
  const RANGE_MIN = new Date(2026, 7, 1).getTime();
  const RANGE_MAX = new Date(2026, 8, 1).getTime();

  /** Routes the calendar list and each calendar's events. */
  function stubCalendars(
    calendars: Record<string, unknown>[],
    events: (calendarId: string) => Reply,
  ) {
    return stubFetch((url) => {
      if (url.includes('/users/me/calendarList')) return { body: { items: calendars } };
      const calendarId = decodeURIComponent(url.split('/calendars/')[1].split('/events')[0]);
      return events(calendarId);
    });
  }

  it('reads every visible calendar and merges the results in order', async () => {
    stubCalendars(
      [
        { id: 'work', summary: 'Work', accessRole: 'owner', backgroundColor: '#f00' },
        { id: 'home', summary: 'Home', accessRole: 'reader' },
      ],
      (calendarId) => ({
        body: {
          items: [
            calendarId === 'work'
              ? raw({ id: 'w1', start: { dateTime: '2026-08-03T15:00:00Z' } })
              : raw({ id: 'h1', start: { dateTime: '2026-08-03T08:00:00Z' } }),
          ],
        },
      }),
    );

    const { events } = await fetchRange(BACKGROUND, RANGE_MIN, RANGE_MAX);

    expect(idsOf(events)).toEqual(['h1', 'w1']);
  });

  it('carries each calendar’s name and colour onto its events', async () => {
    stubCalendars(
      [{ id: 'work', summary: 'Work', accessRole: 'owner', backgroundColor: '#f00' }],
      () => ({ body: { items: [raw({ id: 'w1' })] } }),
    );

    const { events } = await fetchRange(BACKGROUND, RANGE_MIN, RANGE_MAX);

    expect(events[0]).toMatchObject({
      calendarTitle: 'Work',
      calendarColor: '#f00',
      canWrite: true,
    });
  });

  it('marks events from a read-only calendar as unwritable', async () => {
    stubCalendars([{ id: 'home', summary: 'Home', accessRole: 'reader' }], () => ({
      body: { items: [raw({ id: 'h1' })] },
    }));

    const { events } = await fetchRange(BACKGROUND, RANGE_MIN, RANGE_MAX);

    expect(events[0].canWrite).toBe(false);
  });

  it('skips calendars the user has unticked in Google Calendar', async () => {
    const fetchMock = stubCalendars(
      [
        { id: 'work', summary: 'Work', accessRole: 'owner' },
        { id: 'hidden', summary: 'Hidden', selected: false, accessRole: 'owner' },
      ],
      () => ({ body: { items: [] } }),
    );

    await fetchRange(BACKGROUND, RANGE_MIN, RANGE_MAX);

    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requestedUrls.some((url) => url.includes('/calendars/work/events'))).toBe(true);
    expect(requestedUrls.some((url) => url.includes('/calendars/hidden/events'))).toBe(false);
  });

  it('treats a calendar with no `selected` flag as visible', async () => {
    stubCalendars([{ id: 'primary', summary: 'Me', primary: true, accessRole: 'owner' }], () => ({
      body: { items: [raw()] },
    }));

    const { events } = await fetchRange(BACKGROUND, RANGE_MIN, RANGE_MAX);

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

    const { calendars } = await fetchRange(BACKGROUND, RANGE_MIN, RANGE_MAX);

    expect(calendars).toEqual([
      { id: 'primary', title: 'Me', color: undefined, primary: true, canWrite: true },
      { id: 'hidden', title: 'Hidden', color: undefined, primary: false, canWrite: false },
    ]);
  });

  it('falls back to the id when a calendar has no name', async () => {
    stubCalendars([{ id: 'no-name@group.calendar.google.com', accessRole: 'owner' }], () => ({
      body: { items: [] },
    }));

    const { calendars } = await fetchRange(BACKGROUND, RANGE_MIN, RANGE_MAX);

    expect(calendars[0].title).toBe('no-name@group.calendar.google.com');
  });

  it('keeps the other calendars when one fails', async () => {
    stubCalendars(
      [
        { id: 'good', summary: 'Good', accessRole: 'owner' },
        { id: 'lost-access', summary: 'Shared', accessRole: 'reader' },
      ],
      (calendarId) =>
        calendarId === 'lost-access'
          ? { ok: false, status: 403 }
          : { body: { items: [raw({ id: 'ok' })] } },
    );

    const { events } = await fetchRange(BACKGROUND, RANGE_MIN, RANGE_MAX);

    expect(idsOf(events)).toEqual(['ok']);
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

    const { events } = await fetchRange(BACKGROUND, RANGE_MIN, RANGE_MAX);

    expect(idsOf(events)).toEqual(['p1', 'p2', 'p3']);
  });

  it('stops after the page cap rather than paging forever', async () => {
    let page = 0;
    stubCalendars([{ id: 'work', summary: 'Work', accessRole: 'owner' }], () => {
      page++;
      return { body: { items: [raw({ id: `p${page}` })], nextPageToken: 'always-more' } };
    });

    const { events } = await fetchRange(BACKGROUND, RANGE_MIN, RANGE_MAX);

    expect(events).toHaveLength(5);
  });

  it('sends the access token', async () => {
    const fetchMock = stubCalendars([{ id: 'work', accessRole: 'owner' }], () => ({
      body: { items: [] },
    }));

    await fetchRange(BACKGROUND, RANGE_MIN, RANGE_MAX);

    const [, init] = fetchMock.mock.calls[0];
    expect(init!.headers).toMatchObject({ Authorization: 'Bearer test-token' });
  });

  it('asks for the requested window as ISO instants, with recurrences expanded', async () => {
    const fetchMock = stubCalendars([{ id: 'work', accessRole: 'owner' }], () => ({
      body: { items: [] },
    }));

    await fetchRange(BACKGROUND, RANGE_MIN, RANGE_MAX);

    const eventsUrl = String(fetchMock.mock.calls[1][0]);
    expect(eventsUrl).toContain(`timeMin=${encodeURIComponent(new Date(RANGE_MIN).toISOString())}`);
    expect(eventsUrl).toContain(`timeMax=${encodeURIComponent(new Date(RANGE_MAX).toISOString())}`);
    // Recurrences are expanded server-side, so each occurrence is its own event.
    expect(eventsUrl).toContain('singleEvents=true');
  });

  it('rejects when the calendar list itself fails', async () => {
    stubFetch(() => ({ ok: false, status: 401 }));

    await expect(fetchRange(BACKGROUND, RANGE_MIN, RANGE_MAX)).rejects.toThrow('Calendar API 401');
  });

  it('copes with a calendar list that has no items', async () => {
    stubFetch(() => ({ body: {} }));

    await expect(fetchRange(BACKGROUND, RANGE_MIN, RANGE_MAX)).resolves.toEqual({
      events: [],
      calendars: [],
    });
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

    const events = await fetchUpcoming(BACKGROUND, now);

    expect(events).toHaveLength(1);
    const eventsUrl = String(fetchMock.mock.calls[1][0]);
    expect(eventsUrl).toContain(`timeMin=${encodeURIComponent(new Date(now).toISOString())}`);
    expect(eventsUrl).toContain(
      `timeMax=${encodeURIComponent(new Date(now + WINDOW_DAYS * DAY_MS).toISOString())}`,
    );
  });
});
