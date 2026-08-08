import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useUpcomingEvents } from './useUpcomingEvents';
import { hasGoogleClientId } from '../lib/googleAuth';
import { fetchUpcoming, toEvent, type CalendarEvent } from '../lib/gcalEvents';

vi.mock('../lib/googleAuth', () => ({
  hasGoogleClientId: vi.fn(() => true),
  getAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
}));

vi.mock('../lib/gcalEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/gcalEvents')>()),
  fetchUpcoming: vi.fn(),
}));

/** The localStorage slot holding "the user wants the calendar connected". */
const INTENT_KEY = 'gcal.view.connected';

/** `fetchUpcoming`'s first argument: whether a consent popup is allowed. */
const INTERACTIVE = true;
const SILENT = false;

const MINUTE = 60_000;

function event(id: string, date: Date): CalendarEvent {
  const converted = toEvent({ id, summary: id, start: { dateTime: date.toISOString() } }, 'cal-1');
  if (!converted) throw new Error('fixture did not convert');
  return converted;
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

/** The stored "keep me connected" intent. */
const storedIntent = () => JSON.parse(localStorage.getItem(INTENT_KEY)!);

/** Reports the tab becoming visible, or being hidden. */
function setTabVisibility(state: 'visible' | 'hidden') {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.mocked(hasGoogleClientId).mockReturnValue(true);
  vi.mocked(fetchUpcoming).mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useUpcomingEvents before connecting', () => {
  it('starts disconnected and empty', () => {
    const { result } = renderHook(() => useUpcomingEvents());

    expect(result.current).toMatchObject({
      configured: true,
      connected: false,
      loading: false,
      error: '',
      events: [],
      lastLoaded: 0,
    });
  });

  it('reports the feature as unavailable with no Google client id', () => {
    vi.mocked(hasGoogleClientId).mockReturnValue(false);

    const { result } = renderHook(() => useUpcomingEvents());

    expect(result.current.configured).toBe(false);
  });

  it('does not fetch when the app is unconfigured, even if asked to', async () => {
    vi.mocked(hasGoogleClientId).mockReturnValue(false);
    const { result } = renderHook(() => useUpcomingEvents());

    await act(async () => result.current.connect());

    expect(fetchUpcoming).not.toHaveBeenCalled();
  });
});

describe('useUpcomingEvents connect', () => {
  it('loads the agenda interactively, so consent may be requested', async () => {
    const { result } = renderHook(() => useUpcomingEvents());

    await act(async () => result.current.connect());

    expect(fetchUpcoming).toHaveBeenCalledWith(INTERACTIVE, expect.any(Number));
  });

  it('reports itself connected, with the events it loaded', async () => {
    vi.mocked(fetchUpcoming).mockResolvedValue([event('e1', new Date(2026, 7, 3, 9))]);
    const { result } = renderHook(() => useUpcomingEvents());

    await act(async () => result.current.connect());

    expect(result.current.connected).toBe(true);
    expect(result.current.events.map((each) => each.id)).toEqual(['e1']);
    expect(result.current.lastLoaded).toBeGreaterThan(0);
    expect(result.current.error).toBe('');
  });

  it('remembers the intent so a reload reconnects on its own', async () => {
    const { result } = renderHook(() => useUpcomingEvents());

    await act(async () => result.current.connect());

    expect(storedIntent()).toBe(true);
  });

  it('reports loading while the fetch is in flight', async () => {
    const pendingFetch = deferred<CalendarEvent[]>();
    vi.mocked(fetchUpcoming).mockReturnValue(pendingFetch.promise);
    const { result } = renderHook(() => useUpcomingEvents());

    act(() => result.current.connect());
    expect(result.current.loading).toBe(true);

    await act(async () => {
      pendingFetch.resolve([]);
    });
    expect(result.current.loading).toBe(false);
  });

  it('surfaces a refused consent', async () => {
    vi.mocked(fetchUpcoming).mockRejectedValue(new Error('popup closed'));
    const { result } = renderHook(() => useUpcomingEvents());

    await act(async () => result.current.connect());

    expect(result.current.error).toBe('popup closed');
    expect(result.current.connected).toBe(false);
  });

  it('keeps the stored intent after a refused consent', async () => {
    const { result } = renderHook(() => useUpcomingEvents());
    await act(async () => result.current.connect());

    vi.mocked(fetchUpcoming).mockRejectedValue(new Error('popup closed'));
    await act(async () => result.current.connect());

    // An interactive failure is a choice the user just made, not a dead
    // session, so the stored intent is left alone — unlike a silent failure.
    expect(storedIntent()).toBe(true);
  });

  it('falls back to a readable message for a non-Error rejection', async () => {
    vi.mocked(fetchUpcoming).mockRejectedValue('kaboom');
    const { result } = renderHook(() => useUpcomingEvents());

    await act(async () => result.current.connect());

    expect(result.current.error).toBe('Could not load calendar');
  });
});

describe('useUpcomingEvents refresh', () => {
  it('re-reads silently, without risking a popup', async () => {
    const { result } = renderHook(() => useUpcomingEvents());

    await act(async () => result.current.refresh());

    expect(fetchUpcoming).toHaveBeenCalledWith(SILENT, expect.any(Number));
  });

  it('replaces the events with the new list', async () => {
    const { result } = renderHook(() => useUpcomingEvents());
    vi.mocked(fetchUpcoming).mockResolvedValue([event('old', new Date(2026, 7, 3, 9))]);
    await act(async () => result.current.refresh());

    vi.mocked(fetchUpcoming).mockResolvedValue([event('new', new Date(2026, 7, 4, 9))]);
    await act(async () => result.current.refresh());

    expect(result.current.events.map((each) => each.id)).toEqual(['new']);
  });

  it('disconnects quietly when the Google session has gone', async () => {
    const { result } = renderHook(() => useUpcomingEvents());
    await act(async () => result.current.connect());

    vi.mocked(fetchUpcoming).mockRejectedValue(new Error('invalid_grant'));
    await act(async () => result.current.refresh());

    expect(result.current.connected).toBe(false);
  });

  it('forgets the intent when the Google session has gone', async () => {
    const { result } = renderHook(() => useUpcomingEvents());
    await act(async () => result.current.connect());
    expect(storedIntent()).toBe(true);

    vi.mocked(fetchUpcoming).mockRejectedValue(new Error('invalid_grant'));
    await act(async () => result.current.refresh());

    // Stops the poll retrying forever; the user reconnects deliberately.
    expect(storedIntent()).toBe(false);
  });

  it('ignores a second call while one is already in flight', async () => {
    const pendingFetch = deferred<CalendarEvent[]>();
    vi.mocked(fetchUpcoming).mockReturnValue(pendingFetch.promise);
    const { result } = renderHook(() => useUpcomingEvents());

    act(() => result.current.refresh());
    act(() => result.current.refresh());

    expect(fetchUpcoming).toHaveBeenCalledTimes(1);
    await act(async () => {
      pendingFetch.resolve([]);
    });
  });
});

describe('useUpcomingEvents disconnect', () => {
  it('clears the agenda and forgets the intent', async () => {
    vi.mocked(fetchUpcoming).mockResolvedValue([event('e1', new Date(2026, 7, 3, 9))]);
    const { result } = renderHook(() => useUpcomingEvents());
    await act(async () => result.current.connect());

    act(() => result.current.disconnect());

    expect(result.current).toMatchObject({ connected: false, events: [], error: '' });
    expect(storedIntent()).toBe(false);
  });
});

describe('useUpcomingEvents on mount', () => {
  it('reconnects silently when the user was connected before', async () => {
    localStorage.setItem(INTENT_KEY, JSON.stringify(true));

    const { result } = renderHook(() => useUpcomingEvents());

    await waitFor(() => expect(fetchUpcoming).toHaveBeenCalledWith(SILENT, expect.any(Number)));
    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it('stays put when the user never connected', async () => {
    renderHook(() => useUpcomingEvents());
    await act(async () => {});

    expect(fetchUpcoming).not.toHaveBeenCalled();
  });

  it('stays put when the app is unconfigured, whatever the stored intent says', async () => {
    vi.mocked(hasGoogleClientId).mockReturnValue(false);
    localStorage.setItem(INTENT_KEY, JSON.stringify(true));

    renderHook(() => useUpcomingEvents());
    await act(async () => {});

    expect(fetchUpcoming).not.toHaveBeenCalled();
  });
});

describe('useUpcomingEvents while connected', () => {
  it('polls for changes', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useUpcomingEvents());
    await act(async () => result.current.connect());
    vi.mocked(fetchUpcoming).mockClear();

    await act(async () => {
      vi.advanceTimersByTime(5 * MINUTE);
    });

    expect(fetchUpcoming).toHaveBeenCalledWith(SILENT, expect.any(Number));
  });

  it('re-reads when the tab comes back to the foreground', async () => {
    const { result } = renderHook(() => useUpcomingEvents());
    await act(async () => result.current.connect());
    vi.mocked(fetchUpcoming).mockClear();

    await act(async () => setTabVisibility('visible'));

    expect(fetchUpcoming).toHaveBeenCalledTimes(1);
  });

  it('ignores the tab being hidden', async () => {
    const { result } = renderHook(() => useUpcomingEvents());
    await act(async () => result.current.connect());
    vi.mocked(fetchUpcoming).mockClear();

    await act(async () => setTabVisibility('hidden'));

    expect(fetchUpcoming).not.toHaveBeenCalled();
  });

  it('stops polling once disconnected', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useUpcomingEvents());
    await act(async () => result.current.connect());
    act(() => result.current.disconnect());
    vi.mocked(fetchUpcoming).mockClear();

    await act(async () => {
      vi.advanceTimersByTime(15 * MINUTE);
    });

    expect(fetchUpcoming).not.toHaveBeenCalled();
  });

  it('stops polling once unmounted', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useUpcomingEvents());
    await act(async () => result.current.connect());
    unmount();
    vi.mocked(fetchUpcoming).mockClear();

    await act(async () => {
      vi.advanceTimersByTime(15 * MINUTE);
    });

    expect(fetchUpcoming).not.toHaveBeenCalled();
  });
});

describe('the clock useUpcomingEvents exposes', () => {
  it('advances once a minute, so "Now" moves on its own', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useUpcomingEvents());
    const startedAt = result.current.now;

    await act(async () => {
      vi.advanceTimersByTime(MINUTE);
    });

    expect(result.current.now).toBeGreaterThanOrEqual(startedAt);
    expect(result.current.now).not.toBe(0);
  });
});
