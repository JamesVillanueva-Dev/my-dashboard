import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  blankDraft,
  createEvent,
  deleteEvent,
  describeError,
  draftFromEvent,
  needsMove,
  shiftDay,
  toResource,
  updateEvent,
  validateDraft,
  type EventDraft,
} from './gcalWrite';
import { toEvent, type CalendarEvent } from './gcalEvents';

vi.mock('./googleAuth', () => ({
  hasGoogleClientId: () => true,
  getAccessToken: () => Promise.resolve('test-token'),
  clearAccessToken: vi.fn(),
}));

/** The event being edited in the write cases. */
const EVENT_REF = { calendarId: 'cal-1', eventId: 'e1' };

/** Converts a raw Google event the way the read path does. */
function read(raw: Record<string, unknown>): CalendarEvent {
  const event = toEvent({ id: 'e1', summary: 'Thing', ...raw }, 'cal-1', { canWrite: true });
  if (!event) throw new Error('fixture did not convert');
  return event;
}

/** A raw all-day event, as Google reports 3–5 August: an exclusive end of the 6th. */
const RAW_ALL_DAY = { start: { date: '2026-08-03' }, end: { date: '2026-08-06' } };

/** A raw timed event, 09:30–10:45 local on 3 August. */
const RAW_TIMED = {
  start: { dateTime: new Date(2026, 7, 3, 9, 30).toISOString() },
  end: { dateTime: new Date(2026, 7, 3, 10, 45).toISOString() },
};

/** A valid timed draft, overridable per test. */
function draft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    calendarId: 'cal-1',
    title: 'Standup',
    allDay: false,
    startDate: '2026-08-03',
    startTime: '09:00',
    endDate: '2026-08-03',
    endTime: '10:00',
    location: '',
    description: '',
    ...overrides,
  };
}

describe('shiftDay', () => {
  it('steps across a month boundary', () => {
    expect(shiftDay('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('steps across a leap day', () => {
    expect(shiftDay('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDay('2024-02-29', 1)).toBe('2024-03-01');
  });

  it('steps across a DST transition without losing a day', () => {
    // 8 March 2026 is the US spring-forward.
    expect(shiftDay('2026-03-07', 1)).toBe('2026-03-08');
    expect(shiftDay('2026-03-08', 1)).toBe('2026-03-09');
  });
});

describe('blankDraft', () => {
  it('starts at the next whole hour, on the chosen day', () => {
    const now = new Date(2026, 7, 3, 14, 37).getTime();

    const blank = blankDraft('2026-08-11', 'cal-1', now);

    expect(blank.startDate).toBe('2026-08-11');
    expect(blank.startTime).toBe('15:00');
    expect(blank.endDate).toBe('2026-08-11');
    expect(blank.endTime).toBe('16:00');
  });

  it('starts as a timed event on the calendar it was opened from', () => {
    const now = new Date(2026, 7, 3, 14, 37).getTime();

    const blank = blankDraft('2026-08-11', 'cal-1', now);

    expect(blank.allDay).toBe(false);
    expect(blank.calendarId).toBe('cal-1');
  });

  it('wraps to the start of the day when the next hour would pass midnight', () => {
    const now = new Date(2026, 7, 3, 23, 10).getTime();

    const blank = blankDraft('2026-08-03', 'cal-1', now);

    expect(blank.startTime).toBe('00:00');
    expect(blank.endDate).toBe('2026-08-03');
    expect(blank.endTime).toBe('01:00');
  });

  it('produces a draft that validates once titled', () => {
    const titled = { ...blankDraft('2026-08-03', 'cal-1', Date.now()), title: 'X' };

    expect(validateDraft(titled)).toBe('');
  });
});

describe('draftFromEvent', () => {
  it('shows the last day an all-day event covers, not Google’s exclusive end', () => {
    const fromAllDay = draftFromEvent(read(RAW_ALL_DAY));

    expect(fromAllDay.allDay).toBe(true);
    expect(fromAllDay.startDate).toBe('2026-08-03');
    expect(fromAllDay.endDate).toBe('2026-08-05');
  });

  it('keeps a one-day all-day event on one day', () => {
    const fromOneDay = draftFromEvent(
      read({ start: { date: '2026-08-03' }, end: { date: '2026-08-04' } }),
    );

    expect(fromOneDay.startDate).toBe('2026-08-03');
    expect(fromOneDay.endDate).toBe('2026-08-03');
  });

  it('splits a timed event into local date and time fields', () => {
    const fromTimed = draftFromEvent(read(RAW_TIMED));

    expect(fromTimed).toMatchObject({
      allDay: false,
      startDate: '2026-08-03',
      startTime: '09:30',
      endDate: '2026-08-03',
      endTime: '10:45',
    });
  });

  it('blanks the placeholder title rather than writing it back', () => {
    const untitled = draftFromEvent(read({ summary: '', ...RAW_ALL_DAY }));

    expect(untitled.title).toBe('');
  });

  it('carries location, notes and calendar through', () => {
    const withDetails = draftFromEvent(
      read({ location: 'Room 2', description: 'Bring the deck', ...RAW_ALL_DAY }),
    );

    expect(withDetails).toMatchObject({
      location: 'Room 2',
      description: 'Bring the deck',
      calendarId: 'cal-1',
    });
  });
});

describe('toResource', () => {
  it('puts the exclusive end back on an all-day event', () => {
    const resource = toResource(
      draft({ allDay: true, startDate: '2026-08-03', endDate: '2026-08-05' }),
    );

    expect(resource.start).toEqual({ date: '2026-08-03' });
    expect(resource.end).toEqual({ date: '2026-08-06' });
  });

  it('sends a timed event as instants', () => {
    const resource = toResource(draft({ startTime: '09:30', endTime: '10:45' }));

    expect(resource.start).toEqual({ dateTime: new Date(2026, 7, 3, 9, 30).toISOString() });
    expect(resource.end).toEqual({ dateTime: new Date(2026, 7, 3, 10, 45).toISOString() });
  });

  it('sends cleared fields as empty strings, so a PATCH actually clears them', () => {
    const resource = toResource(draft({ location: '   ', description: '' }));

    expect(resource.location).toBe('');
    expect(resource.description).toBe('');
  });

  it('trims the title', () => {
    expect(toResource(draft({ title: '  Standup  ' })).summary).toBe('Standup');
  });

  it('round-trips an all-day event unchanged', () => {
    const resource = toResource(draftFromEvent(read(RAW_ALL_DAY)));

    expect(resource.start).toEqual(RAW_ALL_DAY.start);
    expect(resource.end).toEqual(RAW_ALL_DAY.end);
  });

  it('round-trips a timed event unchanged', () => {
    const resource = toResource(draftFromEvent(read(RAW_TIMED)));

    expect(resource.start).toEqual(RAW_TIMED.start);
    expect(resource.end).toEqual(RAW_TIMED.end);
  });
});

describe('validateDraft', () => {
  it('accepts a well-formed draft', () => {
    expect(validateDraft(draft())).toBe('');
  });

  it('requires a title', () => {
    expect(validateDraft(draft({ title: '   ' }))).toMatch(/title/i);
  });

  it('requires a calendar', () => {
    expect(validateDraft(draft({ calendarId: '' }))).toMatch(/calendar/i);
  });

  it('rejects an end before the start', () => {
    expect(validateDraft(draft({ endTime: '08:00' }))).toMatch(/end after/i);
    expect(validateDraft(draft({ endDate: '2026-08-02' }))).toMatch(/end after/i);
  });

  it('rejects a zero-length timed event', () => {
    expect(validateDraft(draft({ endTime: '09:00' }))).toMatch(/end after/i);
  });

  it('allows an all-day event that starts and ends on the same day', () => {
    const oneDay = draft({ allDay: true, startDate: '2026-08-03', endDate: '2026-08-03' });

    expect(validateDraft(oneDay)).toBe('');
  });

  it('rejects malformed dates and times', () => {
    expect(validateDraft(draft({ startDate: '' }))).toMatch(/valid date/i);
    expect(validateDraft(draft({ startTime: '' }))).toMatch(/valid date/i);
  });

  it('ignores the time fields for an all-day event', () => {
    expect(validateDraft(draft({ allDay: true, startTime: '', endTime: '' }))).toBe('');
  });
});

describe('needsMove', () => {
  it('is false while the draft keeps the same calendar', () => {
    expect(needsMove(EVENT_REF, draft())).toBe(false);
  });

  it('is true once the draft names a different calendar', () => {
    expect(needsMove(EVENT_REF, draft({ calendarId: 'cal-2' }))).toBe(true);
  });

  it('is false for a draft with no calendar at all', () => {
    expect(needsMove(EVENT_REF, draft({ calendarId: '' }))).toBe(false);
  });
});

describe('writing to Google', () => {
  /** Every request the module made: method, path and parsed body. */
  let requests: { method: string; url: string; body: Record<string, unknown> | undefined }[];

  /** Stubs fetch, failing with `status` on the nth call when asked. */
  function stubFetch(fail?: { onCall: number; status: number }) {
    requests = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        requests.push({
          method: init?.method ?? 'GET',
          url,
          body: init?.body ? JSON.parse(init.body as string) : undefined,
        });
        if (fail && requests.length === fail.onCall) {
          return Promise.resolve({
            ok: false,
            status: fail.status,
            json: () => Promise.resolve({}),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'e1' }) });
      }),
    );
  }

  beforeEach(() => stubFetch());
  afterEach(() => vi.unstubAllGlobals());

  it('creates an event by POSTing to the chosen calendar', async () => {
    await createEvent(draft({ calendarId: 'work@group.calendar.google.com' }));

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].url).toContain('/calendars/work%40group.calendar.google.com/events');
    expect(requests[0].body).toMatchObject({ summary: 'Standup' });
  });

  it('updates in place with a PATCH when the calendar is unchanged', async () => {
    await updateEvent(EVENT_REF, draft({ title: 'Retro' }));

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('PATCH');
    expect(requests[0].url).toContain('/calendars/cal-1/events/e1');
    expect(requests[0].body).toMatchObject({ summary: 'Retro' });
  });

  it('moves first, then patches, when the calendar changed', async () => {
    await updateEvent(EVENT_REF, draft({ calendarId: 'cal-2' }));

    expect(requests.map((request) => request.method)).toEqual(['POST', 'PATCH']);
    expect(requests[0].url).toContain('/calendars/cal-1/events/e1/move?destination=cal-2');
    // The patch must land on the *new* calendar, not the old one.
    expect(requests[1].url).toContain('/calendars/cal-2/events/e1');
  });

  it('does not patch when the move fails', async () => {
    stubFetch({ onCall: 1, status: 403 });

    await expect(updateEvent(EVENT_REF, draft({ calendarId: 'cal-2' }))).rejects.toThrow();

    expect(requests).toHaveLength(1);
  });

  it('deletes by id', async () => {
    await deleteEvent(EVENT_REF);

    expect(requests[0].method).toBe('DELETE');
    expect(requests[0].url).toContain('/calendars/cal-1/events/e1');
  });

  it('treats an already-deleted event as success', async () => {
    stubFetch({ onCall: 1, status: 404 });

    await expect(deleteEvent({ calendarId: 'cal-1', eventId: 'gone' })).resolves.toBeUndefined();
  });

  it('still reports a real delete failure', async () => {
    stubFetch({ onCall: 1, status: 403 });

    await expect(deleteEvent(EVENT_REF)).rejects.toThrow();
  });
});

describe('describeError', () => {
  /** An API failure carrying an HTTP status code. */
  const failureWithCode = (code: number) => Object.assign(new Error('boom'), { code });

  it('explains a permission failure', () => {
    expect(describeError(failureWithCode(403))).toMatch(/permission/i);
  });

  it('explains an event that is already gone', () => {
    expect(describeError(failureWithCode(404))).toMatch(/no longer exists/i);
  });

  it('explains an expired session', () => {
    expect(describeError(failureWithCode(401))).toMatch(/expired/i);
  });

  it('passes an ordinary error message through', () => {
    expect(describeError(new Error('offline'))).toBe('offline');
  });

  it('falls back to something sayable for a non-error', () => {
    expect(describeError(null)).toMatch(/went wrong/i);
  });
});
