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

/** Week starts, as the hook takes them. */
const SUNDAY = 0;
const MONDAY = 1;

/** `fetchRange`'s first argument: the month view never prompts for consent. */
const SILENT = false;

function event(id: string, date: Date): CalendarEvent {
  const converted = toEvent(
    {
      id,
      summary: id,
      start: { dateTime: date.toISOString() },
      end: { dateTime: date.toISOString() },
    },
    'cal-1',
  );
  if (!converted) throw new Error('fixture did not convert');
  return converted;
}

/** What `fetchRange` resolves with: events plus the calendar list. */
function rangeResult(overrides: Partial<RangeResult> = {}): RangeResult {
  return { events: [], calendars: [], ...overrides };
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
async function renderMonthEvents(now = NOW, weekStartsOn = SUNDAY) {
  const view = renderHook(() => useMonthEvents(now, weekStartsOn));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

/** The ids of every event currently bucketed, whichever day they fall on. */
const loadedIds = (byDay: Map<string, CalendarEvent[]>) =>
  [...byDay.values()].flat().map((each) => each.id);

beforeEach(() => {
  vi.mocked(fetchRange).mockResolvedValue(rangeResult());
});

describe('useMonthEvents on mount', () => {
  it('opens on the month containing `now`, with today selected', async () => {
    const { result } = await renderMonthEvents();

    expect(result.current).toMatchObject({ year: 2026, month: 7, selectedDay: '2026-08-03' });
    expect(result.current.title).toContain('2026');
  });

  it('builds a six-week grid', async () => {
    const { result } = await renderMonthEvents();

    expect(result.current.weeks).toHaveLength(6);
    expect(result.current.weeks[0]).toHaveLength(7);
  });

  it('loads the visible month, asking for the whole grid’s range', async () => {
    await renderMonthEvents();

    const { timeMin, timeMax } = monthRange(2026, 7, SUNDAY);
    expect(fetchRange).toHaveBeenCalledWith(SILENT, timeMin, timeMax);
  });

  it('never starts a consent flow — the month view only ever reads silently', async () => {
    await renderMonthEvents();

    const everyCallSilent = vi
      .mocked(fetchRange)
      .mock.calls.every(([interactive]) => interactive === false);
    expect(everyCallSilent).toBe(true);
  });

  it('respects a non-Sunday week start in the range it asks for', async () => {
    await renderMonthEvents(NOW, MONDAY);

    const { timeMin, timeMax } = monthRange(2026, 7, MONDAY);
    expect(fetchRange).toHaveBeenCalledWith(SILENT, timeMin, timeMax);
  });

  it('passes the calendar list through for the event form’s picker', async () => {
    vi.mocked(fetchRange).mockResolvedValue(
      rangeResult({ calendars: [{ id: 'cal-1', title: 'Work', primary: true, canWrite: true }] }),
    );

    const { result } = await renderMonthEvents();

    expect(result.current.calendars).toEqual([
      { id: 'cal-1', title: 'Work', primary: true, canWrite: true },
    ]);
  });
});

describe('useMonthEvents day buckets', () => {
  it('buckets the loaded events by day', async () => {
    vi.mocked(fetchRange).mockResolvedValue(
      rangeResult({
        events: [
          event('today-1', new Date(2026, 7, 3, 9)),
          event('today-2', new Date(2026, 7, 3, 14)),
          event('later', new Date(2026, 7, 20, 9)),
        ],
      }),
    );

    const { result } = await renderMonthEvents();

    expect(result.current.byDay.get('2026-08-03')?.map((each) => each.id)).toEqual([
      'today-1',
      'today-2',
    ]);
  });

  it('exposes the selected day’s own events', async () => {
    vi.mocked(fetchRange).mockResolvedValue(
      rangeResult({
        events: [
          event('today-1', new Date(2026, 7, 3, 9)),
          event('later', new Date(2026, 7, 20, 9)),
        ],
      }),
    );

    const { result } = await renderMonthEvents();

    expect(result.current.selectedEvents.map((each) => each.id)).toEqual(['today-1']);
  });

  it('gives an empty list for a day with nothing on it', async () => {
    const { result } = await renderMonthEvents();

    act(() => result.current.selectDay('2026-08-14'));

    expect(result.current.selectedEvents).toEqual([]);
  });
});

describe('useMonthEvents paging', () => {
  it('steps forward a month', async () => {
    const { result } = await renderMonthEvents();

    await act(async () => result.current.next());

    expect(result.current).toMatchObject({ year: 2026, month: 8 });
  });

  it('steps back a month', async () => {
    const { result } = await renderMonthEvents();
    await act(async () => result.current.next());

    await act(async () => result.current.prev());

    expect(result.current).toMatchObject({ year: 2026, month: 7 });
  });

  it('rolls over the year boundary', async () => {
    const { result } = await renderMonthEvents(new Date(2026, 11, 15).getTime());

    await act(async () => result.current.next());

    expect(result.current).toMatchObject({ year: 2027, month: 0 });
  });

  it('moves the selection to the first when it would fall outside the new month', async () => {
    const { result } = await renderMonthEvents();

    await act(async () => result.current.next());

    expect(result.current.selectedDay).toBe('2026-09-01');
  });

  it('leaves a selection that is already inside the month being paged to', async () => {
    const { result } = await renderMonthEvents();
    act(() => result.current.selectDay('2026-09-15'));

    await act(async () => result.current.next());

    expect(result.current.selectedDay).toBe('2026-09-15');
  });

  it('fetches a month it has not seen before', async () => {
    const { result } = await renderMonthEvents();
    vi.mocked(fetchRange).mockClear();

    await act(async () => result.current.next());

    const { timeMin, timeMax } = monthRange(2026, 8, SUNDAY);
    expect(fetchRange).toHaveBeenCalledWith(SILENT, timeMin, timeMax);
  });

  it('serves a month it has already loaded from its own cache', async () => {
    const { result } = await renderMonthEvents();
    await act(async () => result.current.next());
    vi.mocked(fetchRange).mockClear();

    await act(async () => result.current.prev());

    expect(fetchRange).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('paints the month that finished last, not the response that arrived last', async () => {
    const { result } = await renderMonthEvents();
    const september = deferred<RangeResult>();
    const october = deferred<RangeResult>();
    vi.mocked(fetchRange)
      .mockReturnValueOnce(september.promise)
      .mockReturnValueOnce(october.promise);

    act(() => result.current.next()); // September
    act(() => result.current.next()); // October — the month the user is now looking at

    await act(async () => {
      october.resolve(rangeResult({ events: [event('oct', new Date(2026, 9, 5, 9))] }));
    });
    // September answers late, having lost the race.
    await act(async () => {
      september.resolve(rangeResult({ events: [event('sep', new Date(2026, 8, 5, 9))] }));
    });

    expect(result.current.month).toBe(9);
    expect(loadedIds(result.current.byDay)).toEqual(['oct']);
  });
});

describe('useMonthEvents goToday', () => {
  it('jumps back to the current month and reselects today', async () => {
    const { result } = await renderMonthEvents();
    await act(async () => result.current.next());
    await act(async () => result.current.next());

    await act(async () => result.current.goToday());

    expect(result.current).toMatchObject({ year: 2026, month: 7, selectedDay: '2026-08-03' });
  });
});

describe('useMonthEvents refresh', () => {
  it('re-fetches the visible month even though it is cached', async () => {
    const { result } = await renderMonthEvents();
    vi.mocked(fetchRange).mockClear();

    await act(async () => result.current.refresh());

    expect(fetchRange).toHaveBeenCalledTimes(1);
  });

  it('drops every cached month, since a write may have landed elsewhere', async () => {
    const { result } = await renderMonthEvents();
    await act(async () => result.current.next());
    await act(async () => result.current.refresh());
    vi.mocked(fetchRange).mockClear();

    // August was cached before the refresh; it must be fetched again now.
    await act(async () => result.current.prev());

    expect(fetchRange).toHaveBeenCalledTimes(1);
  });
});

describe('useMonthEvents when a load fails', () => {
  it('surfaces the failure message and stops loading', async () => {
    vi.mocked(fetchRange).mockRejectedValue(new Error('Calendar API 401'));

    const { result } = await renderMonthEvents();

    expect(result.current.error).toBe('Calendar API 401');
    expect(result.current.loading).toBe(false);
  });

  it('falls back to a readable message for a non-Error rejection', async () => {
    vi.mocked(fetchRange).mockRejectedValue('kaboom');

    const { result } = await renderMonthEvents();

    expect(result.current.error).toBe('Could not load calendar');
  });

  it('clears the error once a later month loads', async () => {
    vi.mocked(fetchRange).mockRejectedValueOnce(new Error('Calendar API 401'));
    const { result } = await renderMonthEvents();
    expect(result.current.error).toBeTruthy();

    await act(async () => result.current.next());

    expect(result.current.error).toBe('');
  });

  it('does not cache a failed month, so paging back retries it', async () => {
    vi.mocked(fetchRange).mockRejectedValueOnce(new Error('Calendar API 401'));
    const { result } = await renderMonthEvents();
    await act(async () => result.current.next());
    vi.mocked(fetchRange).mockClear();

    await act(async () => result.current.prev());

    expect(fetchRange).toHaveBeenCalledTimes(1);
  });
});

describe('useMonthEvents after unmount', () => {
  it('sets no state when a load lands late', async () => {
    const pendingLoad = deferred<RangeResult>();
    vi.mocked(fetchRange).mockReturnValue(pendingLoad.promise);
    const { unmount } = renderHook(() => useMonthEvents(NOW));

    unmount();

    await act(async () => {
      pendingLoad.resolve(rangeResult());
    });
    // Nothing to assert beyond React staying quiet about an update on a tree
    // that is gone — the guard exists for that alone.
  });
});
