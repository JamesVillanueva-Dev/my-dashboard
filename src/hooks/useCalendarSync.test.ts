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
const INTENT = 'gcal.connected';
const CALENDAR_ID = 'gcal.calendarId';
const SYNC_TOKEN = 'gcal.syncToken';

function reminder(over: Partial<Reminder> = {}): Reminder {
  return { id: 'r1', text: 'Task', due: '2026-08-03T09:00', done: false, ...over };
}

function syncResult(over: Partial<SyncResult> = {}): SyncResult {
  return { reminders: [reminder()], calendarId: 'cal-1', syncToken: 'tok-1', ...over };
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
function setup(initial: Reminder[] = [reminder()]) {
  const store = { reminders: initial };
  const setReminders = vi.fn((next: Reminder[]) => {
    store.reminders = next;
  });
  const hook = renderHook(() => useCalendarSync(() => store.reminders, setReminders));
  return { ...hook, store, setReminders };
}

beforeEach(() => {
  vi.mocked(hasGoogleClientId).mockReturnValue(true);
  vi.mocked(runSync).mockResolvedValue(syncResult());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCalendarSync', () => {
  it('starts disconnected and idle', () => {
    const { result } = setup();

    expect(result.current).toMatchObject({
      configured: true,
      connected: false,
      syncing: false,
      error: '',
    });
  });

  it('reports the feature as unavailable with no Google client id', () => {
    vi.mocked(hasGoogleClientId).mockReturnValue(false);

    const { result } = setup();

    expect(result.current.configured).toBe(false);
  });

  it('does not sync when the app is unconfigured, even if asked to', async () => {
    vi.mocked(hasGoogleClientId).mockReturnValue(false);
    const { result } = setup();

    await act(async () => result.current.connect());

    expect(runSync).not.toHaveBeenCalled();
  });

  describe('connect', () => {
    it('syncs interactively, so consent may be requested', async () => {
      const { result } = setup();

      await act(async () => result.current.connect());

      expect(runSync).toHaveBeenCalledWith(
        expect.objectContaining({ interactive: true, reminders: [reminder()] }),
      );
      expect(result.current.connected).toBe(true);
      expect(result.current.error).toBe('');
    });

    it('writes the reconciled list back', async () => {
      vi.mocked(runSync).mockResolvedValue(syncResult({ reminders: [reminder({ text: 'From Google' })] }));
      const { result, setReminders } = setup();

      await act(async () => result.current.connect());

      expect(setReminders).toHaveBeenCalledWith([reminder({ text: 'From Google' })]);
    });

    it('persists the calendar id, sync token, and the intent to reconnect', async () => {
      const { result } = setup();

      await act(async () => result.current.connect());

      expect(JSON.parse(localStorage.getItem(CALENDAR_ID)!)).toBe('cal-1');
      expect(JSON.parse(localStorage.getItem(SYNC_TOKEN)!)).toBe('tok-1');
      expect(JSON.parse(localStorage.getItem(INTENT)!)).toBe(true);
    });

    it('stores an empty token when Google returns none', async () => {
      vi.mocked(runSync).mockResolvedValue(syncResult({ syncToken: undefined }));
      const { result } = setup();

      await act(async () => result.current.connect());

      expect(JSON.parse(localStorage.getItem(SYNC_TOKEN)!)).toBe('');
    });

    it('sends the stored calendar id and token on the next run', async () => {
      localStorage.setItem(CALENDAR_ID, JSON.stringify('cal-existing'));
      localStorage.setItem(SYNC_TOKEN, JSON.stringify('tok-existing'));
      const { result } = setup();

      await act(async () => result.current.connect());

      expect(runSync).toHaveBeenCalledWith(
        expect.objectContaining({ calendarId: 'cal-existing', syncToken: 'tok-existing' }),
      );
    });

    it('omits an empty calendar id rather than sending a blank string', async () => {
      const { result } = setup();

      await act(async () => result.current.connect());

      expect(runSync).toHaveBeenCalledWith(
        expect.objectContaining({ calendarId: undefined, syncToken: undefined }),
      );
    });

    it('reports syncing while a cycle is in flight', async () => {
      const gate = deferred<SyncResult>();
      vi.mocked(runSync).mockReturnValue(gate.promise);
      const { result } = setup();

      act(() => result.current.connect());
      expect(result.current.syncing).toBe(true);

      await act(async () => {
        gate.resolve(syncResult());
      });
      expect(result.current.syncing).toBe(false);
    });

    it('surfaces a failure and stays disconnected', async () => {
      vi.mocked(runSync).mockRejectedValue(new Error('popup closed'));
      const { result } = setup();

      await act(async () => result.current.connect());

      expect(result.current.error).toBe('popup closed');
      expect(result.current.connected).toBe(false);
      expect(result.current.syncing).toBe(false);
    });

    it('falls back to a readable message for a non-Error rejection', async () => {
      vi.mocked(runSync).mockRejectedValue('kaboom');
      const { result } = setup();

      await act(async () => result.current.connect());

      expect(result.current.error).toBe('Sync failed');
    });

    it('clears a previous error once a run succeeds', async () => {
      vi.mocked(runSync).mockRejectedValueOnce(new Error('flaky'));
      const { result } = setup();
      await act(async () => result.current.connect());
      expect(result.current.error).toBe('flaky');

      await act(async () => result.current.connect());

      expect(result.current.error).toBe('');
    });
  });

  describe('overlapping runs', () => {
    it('folds a request made mid-cycle into one follow-up run', async () => {
      const gate = deferred<SyncResult>();
      vi.mocked(runSync).mockReturnValueOnce(gate.promise).mockResolvedValue(syncResult());
      const { result } = setup();

      act(() => result.current.connect());
      // Two more asks while the first is still running collapse into one rerun.
      act(() => result.current.connect());
      act(() => result.current.connect());
      expect(runSync).toHaveBeenCalledTimes(1);

      await act(async () => {
        gate.resolve(syncResult());
      });

      await waitFor(() => expect(runSync).toHaveBeenCalledTimes(2));
      // The follow-up is silent — the consent popup was already dealt with.
      expect(vi.mocked(runSync).mock.calls[1][0]).toMatchObject({ interactive: false });
    });

    it('feeds the follow-up run the reconciled list, not the snapshot it started from', async () => {
      const reconciled = [reminder({ id: 'r2', text: 'From Google' })];
      const gate = deferred<SyncResult>();
      vi.mocked(runSync).mockReturnValueOnce(gate.promise).mockResolvedValue(syncResult());
      const { result } = setup([reminder()]);

      act(() => result.current.connect());
      act(() => result.current.connect()); // queues a rerun

      await act(async () => {
        gate.resolve(syncResult({ reminders: reconciled }));
      });

      await waitFor(() => expect(runSync).toHaveBeenCalledTimes(2));
      // Reading through the getter rather than a closure is what makes this work.
      expect(vi.mocked(runSync).mock.calls[0][0]).toMatchObject({ reminders: [reminder()] });
      expect(vi.mocked(runSync).mock.calls[1][0]).toMatchObject({ reminders: reconciled });
    });
  });

  describe('syncNow', () => {
    it('waits out the debounce before syncing', async () => {
      vi.useFakeTimers();
      const { result } = setup();

      act(() => result.current.syncNow());
      expect(runSync).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(2_500);
      });

      expect(runSync).toHaveBeenCalledTimes(1);
      expect(runSync).toHaveBeenCalledWith(expect.objectContaining({ interactive: false }));
    });

    it('coalesces a burst of edits into a single sync', async () => {
      vi.useFakeTimers();
      const { result } = setup();

      act(() => result.current.syncNow());
      act(() => vi.advanceTimersByTime(1_000));
      act(() => result.current.syncNow());
      act(() => vi.advanceTimersByTime(1_000));
      act(() => result.current.syncNow());

      // The first two timers were cancelled, so nothing has run yet.
      expect(runSync).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(2_500);
      });

      expect(runSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('disconnect', () => {
    it('forgets the token and the intent to reconnect', async () => {
      const { result } = setup();
      await act(async () => result.current.connect());

      act(() => result.current.disconnect());

      expect(clearAccessToken).toHaveBeenCalledTimes(1);
      expect(result.current.connected).toBe(false);
      expect(JSON.parse(localStorage.getItem(INTENT)!)).toBe(false);
    });
  });

  describe('on mount', () => {
    it('reconnects silently when the user was connected before', async () => {
      localStorage.setItem(INTENT, JSON.stringify(true));

      const { result } = setup();

      await waitFor(() => expect(runSync).toHaveBeenCalledWith(
        expect.objectContaining({ interactive: false }),
      ));
      await waitFor(() => expect(result.current.connected).toBe(true));
    });

    it('stays put when the user never connected', async () => {
      setup();
      await act(async () => {});

      expect(runSync).not.toHaveBeenCalled();
    });

    it('stays put when the app is unconfigured, whatever the stored intent says', async () => {
      vi.mocked(hasGoogleClientId).mockReturnValue(false);
      localStorage.setItem(INTENT, JSON.stringify(true));

      setup();
      await act(async () => {});

      expect(runSync).not.toHaveBeenCalled();
    });
  });

  describe('while connected', () => {
    it('polls once a minute', async () => {
      vi.useFakeTimers();
      const { result } = setup();
      await act(async () => result.current.connect());
      vi.mocked(runSync).mockClear();

      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });

      expect(runSync).toHaveBeenCalledTimes(1);
    });

    it('stops polling once disconnected', async () => {
      vi.useFakeTimers();
      const { result } = setup();
      await act(async () => result.current.connect());
      act(() => result.current.disconnect());
      vi.mocked(runSync).mockClear();

      await act(async () => {
        vi.advanceTimersByTime(5 * 60_000);
      });

      expect(runSync).not.toHaveBeenCalled();
    });

    it('stops polling once unmounted', async () => {
      vi.useFakeTimers();
      const { result, unmount } = setup();
      await act(async () => result.current.connect());
      unmount();
      vi.mocked(runSync).mockClear();

      await act(async () => {
        vi.advanceTimersByTime(5 * 60_000);
      });

      expect(runSync).not.toHaveBeenCalled();
    });
  });
});
