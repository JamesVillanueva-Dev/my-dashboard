import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useMonthEvents } from './useMonthEvents';
import { fetchRange, toEvent, type CalendarEvent, type RangeResult } from '../lib/gcalEvents';
import { monthRange } from '../lib/calendarGrid';

// The network is faked; every date helper is real, so the window this asks for
// is the window the grid actually shows.
vi.mock('../lib/gcalEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/gcalEvents')>()),
  fetchRange: vi.fn(),
}));

/** 3 August 2026, 10:15 local. */
const NOW = new Date(2026, 7, 3, 10, 15).getTime();

function event(id: string, date: Date): CalendarEvent {
  const ev = toEvent(
    { id, summary: id, start: { dateTime: date.toISOString() }, end: { dateTime: date.toISOString() } },
    'cal-1',
  );
  if (!ev) throw new Error('fixture did not convert');
  return ev;
}

function result(over: Partial<RangeResult> = {}): RangeResult {
  return { events: [], calendars: [], ...over };
}

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Mounts the hook and waits out the initial load. */
async function setup(now = NOW, weekStartsOn = 0) {
  const hook = renderHook(() => useMonthEvents(now, weekStartsOn));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  vi.mocked(fetchRange).mockResolvedValue(result());
});

describe('useMonthEvents', () => {
  it('opens on the month containing `now`, with today selected', async () => {
    const { result: r } = await setup();

    expect(r.current).toMatchObject({ year: 2026, month: 7, selectedDay: '2026-08-03' });
    expect(r.current.title).toContain('2026');
  });

  it('builds a six-week grid', async () => {
    const { result: r } = await setup();

    expect(r.current.weeks).toHaveLength(6);
    expect(r.current.weeks[0]).toHaveLength(7);
  });

  it('loads the visible month, asking for the whole grid’s range', async () => {
    await setup();

    const { timeMin, timeMax } = monthRange(2026, 7, 0);
    expect(fetchRange).toHaveBeenCalledWith(false, timeMin, timeMax);
  });

  it('never starts a consent flow — the month view only ever reads silently', async () => {
    await setup();

    expect(vi.mocked(fetchRange).mock.calls.every(([interactive]) => interactive === false)).toBe(
      true,
    );
  });

  it('respects a non-Sunday week start in both the grid and the range', async () => {
    await setup(NOW, 1);

    const { timeMin, timeMax } = monthRange(2026, 7, 1);
    expect(fetchRange).toHaveBeenCalledWith(false, timeMin, timeMax);
  });

  it('buckets the loaded events by day and exposes the selected day’s own', async () => {
    vi.mocked(fetchRange).mockResolvedValue(
      result({
        events: [
          event('today-1', new Date(2026, 7, 3, 9)),
          event('today-2', new Date(2026, 7, 3, 14)),
          event('later', new Date(2026, 7, 20, 9)),
        ],
      }),
    );

    const { result: r } = await setup();

    expect(r.current.byDay.get('2026-08-03')?.map((e) => e.id)).toEqual(['today-1', 'today-2']);
    expect(r.current.selectedEvents.map((e) => e.id)).toEqual(['today-1', 'today-2']);
  });

  it('gives an empty list for a day with nothing on it', async () => {
    const { result: r } = await setup();

    act(() => r.current.selectDay('2026-08-14'));

    expect(r.current.selectedEvents).toEqual([]);
  });

  it('passes the calendar list through for the event form’s picker', async () => {
    vi.mocked(fetchRange).mockResolvedValue(
      result({ calendars: [{ id: 'cal-1', title: 'Work', primary: true, canWrite: true }] }),
    );

    const { result: r } = await setup();

    expect(r.current.calendars).toEqual([
      { id: 'cal-1', title: 'Work', primary: true, canWrite: true },
    ]);
  });

  describe('paging', () => {
    it('steps forward and back a month at a time', async () => {
      const { result: r } = await setup();

      await act(async () => r.current.next());
      expect(r.current).toMatchObject({ year: 2026, month: 8 });

      await act(async () => r.current.prev());
      expect(r.current).toMatchObject({ year: 2026, month: 7 });
    });

    it('rolls over the year boundary', async () => {
      const { result: r } = await setup(new Date(2026, 11, 15).getTime());

      await act(async () => r.current.next());

      expect(r.current).toMatchObject({ year: 2027, month: 0 });
    });

    it('moves the selection to the first when it would fall outside the new month', async () => {
      const { result: r } = await setup();

      await act(async () => r.current.next());

      expect(r.current.selectedDay).toBe('2026-09-01');
    });

    it('leaves a selection that is already inside the month being paged to', async () => {
      const { result: r } = await setup();
      act(() => r.current.selectDay('2026-09-15'));

      await act(async () => r.current.next());

      expect(r.current.selectedDay).toBe('2026-09-15');
    });

    it('fetches a month it has not seen before', async () => {
      const { result: r } = await setup();
      vi.mocked(fetchRange).mockClear();

      await act(async () => r.current.next());

      const { timeMin, timeMax } = monthRange(2026, 8, 0);
      expect(fetchRange).toHaveBeenCalledWith(false, timeMin, timeMax);
    });

    it('serves a month it has already loaded from its own cache', async () => {
      const { result: r } = await setup();
      await act(async () => r.current.next());
      vi.mocked(fetchRange).mockClear();

      await act(async () => r.current.prev());

      expect(fetchRange).not.toHaveBeenCalled();
      expect(r.current.loading).toBe(false);
    });

    it('paints the month that finished last, not the response that arrived last', async () => {
      const { result: r } = await setup();

      const september = deferred<RangeResult>();
      const october = deferred<RangeResult>();
      vi.mocked(fetchRange)
        .mockReturnValueOnce(september.promise)
        .mockReturnValueOnce(october.promise);

      act(() => r.current.next()); // September
      act(() => r.current.next()); // October — the month the user is now looking at

      await act(async () => {
        october.resolve(result({ events: [event('oct', new Date(2026, 9, 5, 9))] }));
      });
      // September answers late, having lost the race.
      await act(async () => {
        september.resolve(result({ events: [event('sep', new Date(2026, 8, 5, 9))] }));
      });

      expect(r.current.month).toBe(9);
      expect([...r.current.byDay.values()].flat().map((e) => e.id)).toEqual(['oct']);
    });
  });

  describe('goToday', () => {
    it('jumps back to the current month and reselects today', async () => {
      const { result: r } = await setup();
      await act(async () => r.current.next());
      await act(async () => r.current.next());

      await act(async () => r.current.goToday());

      expect(r.current).toMatchObject({ year: 2026, month: 7, selectedDay: '2026-08-03' });
    });
  });

  describe('refresh', () => {
    it('re-fetches the visible month even though it is cached', async () => {
      const { result: r } = await setup();
      vi.mocked(fetchRange).mockClear();

      await act(async () => r.current.refresh());

      expect(fetchRange).toHaveBeenCalledTimes(1);
    });

    it('drops every cached month, since a write may have landed elsewhere', async () => {
      const { result: r } = await setup();
      await act(async () => r.current.next());
      await act(async () => r.current.refresh());
      vi.mocked(fetchRange).mockClear();

      // August was cached before the refresh; it must be fetched again now.
      await act(async () => r.current.prev());

      expect(fetchRange).toHaveBeenCalledTimes(1);
    });
  });

  describe('errors', () => {
    it('surfaces the failure message and stops loading', async () => {
      vi.mocked(fetchRange).mockRejectedValue(new Error('Calendar API 401'));

      const { result: r } = await setup();

      expect(r.current.error).toBe('Calendar API 401');
      expect(r.current.loading).toBe(false);
    });

    it('falls back to a readable message for a non-Error rejection', async () => {
      vi.mocked(fetchRange).mockRejectedValue('kaboom');

      const { result: r } = await setup();

      expect(r.current.error).toBe('Could not load calendar');
    });

    it('clears the error once a later month loads', async () => {
      vi.mocked(fetchRange).mockRejectedValueOnce(new Error('Calendar API 401'));
      const { result: r } = await setup();
      expect(r.current.error).toBeTruthy();

      await act(async () => r.current.next());

      expect(r.current.error).toBe('');
    });

    it('does not cache a failed month, so paging back retries it', async () => {
      vi.mocked(fetchRange).mockRejectedValueOnce(new Error('Calendar API 401'));
      const { result: r } = await setup();
      await act(async () => r.current.next());
      vi.mocked(fetchRange).mockClear();

      await act(async () => r.current.prev());

      expect(fetchRange).toHaveBeenCalledTimes(1);
    });
  });

  it('sets no state after unmount', async () => {
    const gate = deferred<RangeResult>();
    vi.mocked(fetchRange).mockReturnValue(gate.promise);
    const { unmount } = renderHook(() => useMonthEvents(NOW));

    unmount();

    await act(async () => {
      gate.resolve(result());
    });
    // Nothing to assert beyond React staying quiet about an update on a tree
    // that is gone — the guard exists for that alone.
  });
});
