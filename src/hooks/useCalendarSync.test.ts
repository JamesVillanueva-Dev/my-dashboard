import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCalendarSync } from './useCalendarSync';
import { clearAccessToken, hasGoogleClientId } from '../lib/googleAuth';
import { runSync, type Reminder, type SyncResult } from '../lib/gcalSync';

vi.mock('../lib/googleAuth', () => ({
  hasGoogleClientId: vi.fn(() => true),
  getAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
}));

vi.mock('../lib/gcalSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/gcalSync')>()),
  runSync: vi.fn(),
}));

/** The localStorage slots this hook owns. */
const INTENT_KEY = 'gcal.connected';
const CALENDAR_ID_KEY = 'gcal.calendarId';
const SYNC_TOKEN_KEY = 'gcal.syncToken';

const MINUTE = 60_000;
/** Longer than the syncNow debounce. */
const PAST_DEBOUNCE = 2_500;

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return { id: 'r1', text: 'Task', due: '2026-08-03T09:00', done: false, ...overrides };
}

function syncResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return { reminders: [reminder()], calendarId: 'cal-1', syncToken: 'tok-1', ...overrides };
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

/** Mounts the hook over a reminder list the test can inspect. */
function renderCalendarSync(initialReminders: Reminder[] = [reminder()]) {
  const store = { reminders: initialReminders };
  const setReminders = vi.fn((next: Reminder[]) => {
    store.reminders = next;
  });
  const view = renderHook(() => useCalendarSync(() => store.reminders, setReminders));
  return { ...view, store, setReminders };
}

/** The arguments of the nth `runSync` call. */
const syncCall = (index: number) => vi.mocked(runSync).mock.calls[index][0];

/** A JSON value the hook persisted. */
const stored = (key: string) => JSON.parse(localStorage.getItem(key)!);

/** Records the user having connected on a previous visit. */
const seedConnectedIntent = () => localStorage.setItem(INTENT_KEY, JSON.stringify(true));

/** Reports the tab regaining focus. */
const returnToTab = () =>
  act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });

beforeEach(() => {
  vi.mocked(hasGoogleClientId).mockReturnValue(true);
  vi.mocked(runSync).mockResolvedValue(syncResult());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCalendarSync before connecting', () => {
  it('starts disconnected and idle', () => {
    const { result } = renderCalendarSync();

    expect(result.current).toMatchObject({
      configured: true,
      connected: false,
      syncing: false,
      error: '',
    });
  });

  it('reports the feature as unavailable with no Google client id', () => {
    vi.mocked(hasGoogleClientId).mockReturnValue(false);

    const { result } = renderCalendarSync();

    expect(result.current.configured).toBe(false);
  });

  it('does not sync when the app is unconfigured, even if asked to', async () => {
    vi.mocked(hasGoogleClientId).mockReturnValue(false);
    const { result } = renderCalendarSync();

    await act(async () => result.current.connect());

    expect(runSync).not.toHaveBeenCalled();
  });
});

describe('useCalendarSync connect', () => {
  it('syncs interactively, so consent may be requested', async () => {
    const { result } = renderCalendarSync();

    await act(async () => result.current.connect());

    expect(runSync).toHaveBeenCalledWith(
      expect.objectContaining({ interactive: true, reminders: [reminder()] }),
    );
    expect(result.current.connected).toBe(true);
    expect(result.current.error).toBe('');
  });

  it('writes the reconciled list back', async () => {
    vi.mocked(runSync).mockResolvedValue(
      syncResult({ reminders: [reminder({ text: 'From Google' })] }),
    );
    const { result, setReminders } = renderCalendarSync();

    await act(async () => result.current.connect());

    expect(setReminders).toHaveBeenCalledWith([reminder({ text: 'From Google' })]);
  });

  it('persists the calendar id, sync token, and the intent to reconnect', async () => {
    const { result } = renderCalendarSync();

    await act(async () => result.current.connect());

    expect(stored(CALENDAR_ID_KEY)).toBe('cal-1');
    expect(stored(SYNC_TOKEN_KEY)).toBe('tok-1');
    expect(stored(INTENT_KEY)).toBe(true);
  });

  it('stores an empty token when Google returns none', async () => {
    vi.mocked(runSync).mockResolvedValue(syncResult({ syncToken: undefined }));
    const { result } = renderCalendarSync();

    await act(async () => result.current.connect());

    expect(stored(SYNC_TOKEN_KEY)).toBe('');
  });

  it('sends the stored calendar id and token on the next run', async () => {
    localStorage.setItem(CALENDAR_ID_KEY, JSON.stringify('cal-existing'));
    localStorage.setItem(SYNC_TOKEN_KEY, JSON.stringify('tok-existing'));
    const { result } = renderCalendarSync();

    await act(async () => result.current.connect());

    expect(runSync).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: 'cal-existing', syncToken: 'tok-existing' }),
    );
  });

  it('omits an empty calendar id rather than sending a blank string', async () => {
    const { result } = renderCalendarSync();

    await act(async () => result.current.connect());

    expect(runSync).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: undefined, syncToken: undefined }),
    );
  });

  it('reports syncing while a cycle is in flight', async () => {
    const pendingSync = deferred<SyncResult>();
    vi.mocked(runSync).mockReturnValue(pendingSync.promise);
    const { result } = renderCalendarSync();

    act(() => result.current.connect());
    expect(result.current.syncing).toBe(true);

    await act(async () => {
      pendingSync.resolve(syncResult());
    });
    expect(result.current.syncing).toBe(false);
  });

  it('surfaces a failure and stays disconnected', async () => {
    vi.mocked(runSync).mockRejectedValue(new Error('popup closed'));
    const { result } = renderCalendarSync();

    await act(async () => result.current.connect());

    expect(result.current.error).toBe('popup closed');
    expect(result.current.connected).toBe(false);
    expect(result.current.syncing).toBe(false);
  });

  it('falls back to a readable message for a non-Error rejection', async () => {
    vi.mocked(runSync).mockRejectedValue('kaboom');
    const { result } = renderCalendarSync();

    await act(async () => result.current.connect());

    expect(result.current.error).toBe('Sync failed');
  });

  it('clears a previous error once a run succeeds', async () => {
    vi.mocked(runSync).mockRejectedValueOnce(new Error('flaky'));
    const { result } = renderCalendarSync();
    await act(async () => result.current.connect());
    expect(result.current.error).toBe('flaky');

    await act(async () => result.current.connect());

    expect(result.current.error).toBe('');
  });
});

describe('useCalendarSync with overlapping runs', () => {
  it('folds requests made mid-cycle into one follow-up run', async () => {
    const pendingSync = deferred<SyncResult>();
    vi.mocked(runSync).mockReturnValueOnce(pendingSync.promise).mockResolvedValue(syncResult());
    const { result } = renderCalendarSync();

    act(() => result.current.connect());
    // Two more asks while the first is still running collapse into one rerun.
    act(() => result.current.connect());
    act(() => result.current.connect());
    expect(runSync).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingSync.resolve(syncResult());
    });

    await waitFor(() => expect(runSync).toHaveBeenCalledTimes(2));
  });

  it('makes the follow-up run silent, the popup having been dealt with', async () => {
    const pendingSync = deferred<SyncResult>();
    vi.mocked(runSync).mockReturnValueOnce(pendingSync.promise).mockResolvedValue(syncResult());
    const { result } = renderCalendarSync();

    act(() => result.current.connect());
    act(() => result.current.connect());
    await act(async () => {
      pendingSync.resolve(syncResult());
    });

    await waitFor(() => expect(runSync).toHaveBeenCalledTimes(2));
    expect(syncCall(1)).toMatchObject({ interactive: false });
  });

  it('feeds the follow-up run the reconciled list, not the snapshot it started from', async () => {
    const reconciled = [reminder({ id: 'r2', text: 'From Google' })];
    const pendingSync = deferred<SyncResult>();
    vi.mocked(runSync).mockReturnValueOnce(pendingSync.promise).mockResolvedValue(syncResult());
    const { result } = renderCalendarSync([reminder()]);

    act(() => result.current.connect());
    act(() => result.current.connect()); // queues a rerun

    await act(async () => {
      pendingSync.resolve(syncResult({ reminders: reconciled }));
    });

    await waitFor(() => expect(runSync).toHaveBeenCalledTimes(2));
    // Reading through the getter rather than a closure is what makes this work.
    expect(syncCall(0)).toMatchObject({ reminders: [reminder()] });
    expect(syncCall(1)).toMatchObject({ reminders: reconciled });
  });
});

describe('useCalendarSync syncNow', () => {
  it('waits out the debounce before syncing', async () => {
    vi.useFakeTimers();
    const { result } = renderCalendarSync();

    act(() => result.current.syncNow());
    expect(runSync).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(PAST_DEBOUNCE);
    });

    expect(runSync).toHaveBeenCalledTimes(1);
    expect(runSync).toHaveBeenCalledWith(expect.objectContaining({ interactive: false }));
  });

  it('coalesces a burst of edits into a single sync', async () => {
    vi.useFakeTimers();
    const { result } = renderCalendarSync();

    act(() => result.current.syncNow());
    act(() => vi.advanceTimersByTime(1_000));
    act(() => result.current.syncNow());
    act(() => vi.advanceTimersByTime(1_000));
    act(() => result.current.syncNow());

    // The first two timers were cancelled, so nothing has run yet.
    expect(runSync).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(PAST_DEBOUNCE);
    });

    expect(runSync).toHaveBeenCalledTimes(1);
  });
});

describe('useCalendarSync disconnect', () => {
  it('forgets the token and the intent to reconnect', async () => {
    const { result } = renderCalendarSync();
    await act(async () => result.current.connect());

    act(() => result.current.disconnect());

    expect(clearAccessToken).toHaveBeenCalledTimes(1);
    expect(result.current.connected).toBe(false);
    expect(stored(INTENT_KEY)).toBe(false);
  });

  it('gives up the earned trust, so a failed reconnect reads as disconnected', async () => {
    const { result } = renderCalendarSync();
    await act(async () => result.current.connect());
    act(() => result.current.disconnect());

    vi.mocked(runSync).mockRejectedValue(new Error('popup closed'));
    await act(async () => result.current.connect());

    expect(result.current.connected).toBe(false);
  });
});

describe('useCalendarSync on mount', () => {
  it('reconnects silently when the user was connected before', async () => {
    seedConnectedIntent();

    const { result } = renderCalendarSync();

    await waitFor(() =>
      expect(runSync).toHaveBeenCalledWith(expect.objectContaining({ interactive: false })),
    );
    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it('stays put when the user never connected', async () => {
    renderCalendarSync();
    await act(async () => {});

    expect(runSync).not.toHaveBeenCalled();
  });

  it('stays put when the app is unconfigured, whatever the stored intent says', async () => {
    vi.mocked(hasGoogleClientId).mockReturnValue(false);
    seedConnectedIntent();

    renderCalendarSync();
    await act(async () => {});

    expect(runSync).not.toHaveBeenCalled();
  });

  it('shows as connected while the silent reconnect is still in flight', () => {
    seedConnectedIntent();
    vi.mocked(runSync).mockReturnValue(deferred<SyncResult>().promise);

    const { result } = renderCalendarSync();

    // Never a Connect button in the gap — that is the whole point.
    expect(result.current.connected).toBe(true);
  });

  it('falls back to disconnected when the silent reconnect fails', async () => {
    seedConnectedIntent();
    vi.mocked(runSync).mockRejectedValue(new Error('popup_failed_to_open'));

    const { result } = renderCalendarSync();

    await waitFor(() => expect(result.current.connected).toBe(false));
  });

  it('does not blame the user for a reconnect they cannot fix', async () => {
    seedConnectedIntent();
    vi.mocked(runSync).mockRejectedValue(new Error('popup_failed_to_open'));

    const { result } = renderCalendarSync();

    await waitFor(() => expect(result.current.connected).toBe(false));
    expect(result.current.error).toBe('');
  });
});

describe('useCalendarSync when the tab regains focus', () => {
  it('retries a reconnect that failed earlier', async () => {
    seedConnectedIntent();
    vi.mocked(runSync).mockRejectedValue(new Error('popup_failed_to_open'));
    const { result } = renderCalendarSync();
    await waitFor(() => expect(result.current.connected).toBe(false));

    vi.mocked(runSync).mockResolvedValue(syncResult());
    await returnToTab();

    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it('leaves a user who never connected alone', async () => {
    renderCalendarSync();

    await returnToTab();

    expect(runSync).not.toHaveBeenCalled();
  });
});

describe('useCalendarSync while connected', () => {
  it('polls once a minute', async () => {
    vi.useFakeTimers();
    const { result } = renderCalendarSync();
    await act(async () => result.current.connect());
    vi.mocked(runSync).mockClear();

    await act(async () => {
      vi.advanceTimersByTime(MINUTE);
    });

    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it('rides out a failed poll rather than dropping a working session', async () => {
    vi.useFakeTimers();
    const { result } = renderCalendarSync();
    await act(async () => result.current.connect());

    vi.mocked(runSync).mockRejectedValue(new Error('rate limited'));
    await act(async () => {
      vi.advanceTimersByTime(MINUTE);
    });

    // Proven connections stay put, and this one is worth reporting: it is a
    // real sync failing, not a token we never had.
    expect(result.current.connected).toBe(true);
    expect(result.current.error).toBe('rate limited');
  });

  it('stops polling once disconnected', async () => {
    vi.useFakeTimers();
    const { result } = renderCalendarSync();
    await act(async () => result.current.connect());
    act(() => result.current.disconnect());
    vi.mocked(runSync).mockClear();

    await act(async () => {
      vi.advanceTimersByTime(5 * MINUTE);
    });

    expect(runSync).not.toHaveBeenCalled();
  });

  it('stops polling once unmounted', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderCalendarSync();
    await act(async () => result.current.connect());
    unmount();
    vi.mocked(runSync).mockClear();

    await act(async () => {
      vi.advanceTimersByTime(5 * MINUTE);
    });

    expect(runSync).not.toHaveBeenCalled();
  });
});
