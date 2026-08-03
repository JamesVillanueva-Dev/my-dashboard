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

/** Converts a raw Google event the way the read path does. */
function read(raw: Record<string, unknown>): CalendarEvent {
  const ev = toEvent({ id: 'e1', summary: 'Thing', ...raw }, 'cal-1', { canWrite: true });
  if (!ev) throw new Error('fixture did not convert');
  return ev;
}

/** A valid timed draft, overridable per test. */
function draft(over: Partial<EventDraft> = {}): EventDraft {
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
    ...over,
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
    const d = blankDraft('2026-08-11', 'cal-1', now);

    expect(d.startDate).toBe('2026-08-11');
    expect(d.startTime).toBe('15:00');
    expect(d.endDate).toBe('2026-08-11');
    expect(d.endTime).toBe('16:00');
    expect(d.allDay).toBe(false);
    expect(d.calendarId).toBe('cal-1');
  });

  it('rolls the end onto the next day when it would pass midnight', () => {
    const now = new Date(2026, 7, 3, 23, 10).getTime();
    const d = blankDraft('2026-08-03', 'cal-1', now);

    expect(d.startTime).toBe('00:00');
    expect(d.endDate).toBe('2026-08-03');
    expect(d.endTime).toBe('01:00');
  });

  it('produces a draft that validates', () => {
    expect(validateDraft({ ...blankDraft('2026-08-03', 'cal-1', Date.now()), title: 'X' })).toBe('');
  });
});

describe('draftFromEvent', () => {
  it('shows the last day an all-day event covers, not Google’s exclusive end', () => {
    // 3–5 August arrives from Google as end.date 2026-08-06.
    const d = draftFromEvent(read({ start: { date: '2026-08-03' }, end: { date: '2026-08-06' } }));

    expect(d.allDay).toBe(true);
    expect(d.startDate).toBe('2026-08-03');
    expect(d.endDate).toBe('2026-08-05');
  });

  it('keeps a one-day all-day event on one day', () => {
    const d = draftFromEvent(read({ start: { date: '2026-08-03' }, end: { date: '2026-08-04' } }));
    expect(d.startDate).toBe('2026-08-03');
    expect(d.endDate).toBe('2026-08-03');
  });

  it('splits a timed event into local date and time fields', () => {
    const start = new Date(2026, 7, 3, 9, 30).toISOString();
    const end = new Date(2026, 7, 3, 10, 45).toISOString();
    const d = draftFromEvent(read({ start: { dateTime: start }, end: { dateTime: end } }));

    expect(d).toMatchObject({
      allDay: false,
      startDate: '2026-08-03',
      startTime: '09:30',
      endDate: '2026-08-03',
      endTime: '10:45',
    });
  });

  it('blanks the placeholder title rather than writing it back', () => {
    const d = draftFromEvent(read({ summary: '', start: { date: '2026-08-03' }, end: { date: '2026-08-04' } }));
    expect(d.title).toBe('');
  });

  it('carries location, notes and calendar through', () => {
    const d = draftFromEvent(
      read({
        location: 'Room 2',
        description: 'Bring the deck',
        start: { date: '2026-08-03' },
        end: { date: '2026-08-04' },
      }),
    );
    expect(d).toMatchObject({ location: 'Room 2', description: 'Bring the deck', calendarId: 'cal-1' });
  });
});

describe('toResource', () => {
  it('puts the exclusive end back on an all-day event', () => {
    const r = toResource(draft({ allDay: true, startDate: '2026-08-03', endDate: '2026-08-05' }));
    expect(r.start).toEqual({ date: '2026-08-03' });
    expect(r.end).toEqual({ date: '2026-08-06' });
  });

  it('sends a timed event as instants', () => {
    const r = toResource(draft({ startTime: '09:30', endTime: '10:45' }));
    expect(r.start).toEqual({ dateTime: new Date(2026, 7, 3, 9, 30).toISOString() });
    expect(r.end).toEqual({ dateTime: new Date(2026, 7, 3, 10, 45).toISOString() });
  });

  it('sends cleared fields as empty strings, so a PATCH actually clears them', () => {
    const r = toResource(draft({ location: '   ', description: '' }));
    expect(r.location).toBe('');
    expect(r.description).toBe('');
  });

  it('trims the title', () => {
    expect(toResource(draft({ title: '  Standup  ' })).summary).toBe('Standup');
  });

  it('round-trips an all-day event unchanged', () => {
    const raw = { start: { date: '2026-08-03' }, end: { date: '2026-08-06' } };
    const r = toResource(draftFromEvent(read(raw)));
    expect(r.start).toEqual(raw.start);
    expect(r.end).toEqual(raw.end);
  });

  it('round-trips a timed event unchanged', () => {
    const raw = {
      start: { dateTime: new Date(2026, 7, 3, 9, 30).toISOString() },
      end: { dateTime: new Date(2026, 7, 3, 10, 45).toISOString() },
    };
    const r = toResource(draftFromEvent(read(raw)));
    expect(r.start).toEqual(raw.start);
    expect(r.end).toEqual(raw.end);
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
    expect(
      validateDraft(draft({ allDay: true, startDate: '2026-08-03', endDate: '2026-08-03' })),
    ).toBe('');
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
  it('is true only when the target calendar changed', () => {
    const ref = { calendarId: 'cal-1', eventId: 'e1' };
    expect(needsMove(ref, draft())).toBe(false);
    expect(needsMove(ref, draft({ calendarId: 'cal-2' }))).toBe(true);
    expect(needsMove(ref, draft({ calendarId: '' }))).toBe(false);
  });
});

describe('writes', () => {
  /** Every request the module made: method, path and parsed body. */
  let calls: { method: string; url: string; body: Record<string, unknown> | undefined }[];

  /** Stubs fetch, failing with `status` on the nth call when asked. */
  function stubFetch(fail?: { onCall: number; status: number }) {
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({
          method: init?.method ?? 'GET',
          url,
          body: init?.body ? JSON.parse(init.body as string) : undefined,
        });
        if (fail && calls.length === fail.onCall) {
          return Promise.resolve({ ok: false, status: fail.status, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'e1' }) });
      }),
    );
  }

  beforeEach(() => stubFetch());
  afterEach(() => vi.unstubAllGlobals());

  it('creates an event by POSTing to the chosen calendar', async () => {
    await createEvent(draft({ calendarId: 'work@group.calendar.google.com' }));

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/calendars/work%40group.calendar.google.com/events');
    expect(calls[0].body).toMatchObject({ summary: 'Standup' });
  });

  it('updates in place with a PATCH when the calendar is unchanged', async () => {
    await updateEvent({ calendarId: 'cal-1', eventId: 'e1' }, draft({ title: 'Retro' }));

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toContain('/calendars/cal-1/events/e1');
    expect(calls[0].body).toMatchObject({ summary: 'Retro' });
  });

  it('moves first, then patches, when the calendar changed', async () => {
    await updateEvent({ calendarId: 'cal-1', eventId: 'e1' }, draft({ calendarId: 'cal-2' }));

    expect(calls.map((c) => c.method)).toEqual(['POST', 'PATCH']);
    expect(calls[0].url).toContain('/calendars/cal-1/events/e1/move?destination=cal-2');
    // The patch must land on the *new* calendar, not the old one.
    expect(calls[1].url).toContain('/calendars/cal-2/events/e1');
  });

  it('does not patch when the move fails', async () => {
    stubFetch({ onCall: 1, status: 403 });

    await expect(
      updateEvent({ calendarId: 'cal-1', eventId: 'e1' }, draft({ calendarId: 'cal-2' })),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('deletes by id', async () => {
    await deleteEvent({ calendarId: 'cal-1', eventId: 'e1' });

    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toContain('/calendars/cal-1/events/e1');
  });

  it('treats an already-deleted event as success', async () => {
    stubFetch({ onCall: 1, status: 404 });
    await expect(deleteEvent({ calendarId: 'cal-1', eventId: 'gone' })).resolves.toBeUndefined();
  });

  it('still reports a real delete failure', async () => {
    stubFetch({ onCall: 1, status: 403 });
    await expect(deleteEvent({ calendarId: 'cal-1', eventId: 'e1' })).rejects.toThrow();
  });
});

describe('describeError', () => {
  it('explains the codes a user can act on', () => {
    const withCode = (code: number) => Object.assign(new Error('boom'), { code });
    expect(describeError(withCode(403))).toMatch(/permission/i);
    expect(describeError(withCode(404))).toMatch(/no longer exists/i);
    expect(describeError(withCode(401))).toMatch(/expired/i);
    expect(describeError(new Error('offline'))).toBe('offline');
    expect(describeError(null)).toMatch(/went wrong/i);
  });
});
