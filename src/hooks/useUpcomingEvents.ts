import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { hasGoogleClientId } from '../lib/googleAuth';
import { fetchUpcoming, type CalendarEvent } from '../lib/gcalEvents';

/** Refresh cadence while connected (ms). Slower than Reminders sync — an
 *  agenda that is a few minutes stale costs nothing, and this reads every
 *  calendar the user has rather than one. */
const POLL_MS = 5 * 60_000;

/** What {@link useUpcomingEvents} exposes to the widget. */
export interface UpcomingEvents {
  /** A Google client id is configured (feature is available at all). */
  configured: boolean;
  /** We hold a usable token and have loaded at least once. */
  connected: boolean;
  /** A fetch is in flight. */
  loading: boolean;
  /** Last error message, or '' if none. */
  error: string;
  /** Events in the next few days, sorted. */
  events: CalendarEvent[];
  /**
   * Current time, re-read once a minute. Rendering from this rather than
   * calling `Date.now()` inline keeps the widget a pure function of state, and
   * makes "Now" and the dimming of finished events advance on their own.
   */
  now: number;
  /** Epoch ms of the last successful load, or 0. */
  lastLoaded: number;
  /** Start reading the calendar — opens the consent popup (call from a click). */
  connect: () => void;
  /** Stop reading and forget the in-memory token. */
  disconnect: () => void;
  /** Re-fetch now, silently. */
  refresh: () => void;
}

/**
 * Loads the user's upcoming Google Calendar events for the agenda widget.
 *
 * Read-only: nothing here writes to Google. Connection *intent* persists to
 * localStorage so a reload reconnects silently, matching `useCalendarSync`;
 * the access token itself stays in memory only.
 *
 * Refreshes on a slow poll and whenever the tab becomes visible, so coming back
 * to the dashboard after a few hours shows a current agenda rather than waiting
 * out the interval.
 */
export function useUpcomingEvents(): UpcomingEvents {
  const configured = hasGoogleClientId();
  // Separate from `gcal.connected` (Reminders sync): a user may want to view
  // their calendar without syncing reminders, or the reverse.
  const [wantConnected, setWantConnected] = useLocalStorage<boolean>('gcal.view.connected', false);

  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [lastLoaded, setLastLoaded] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // A minute is fine granularity for an agenda and costs one render per minute.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (interactive: boolean) => {
      if (!hasGoogleClientId() || busyRef.current) return;
      busyRef.current = true;
      setLoading(true);
      try {
        const next = await fetchUpcoming(interactive, Date.now());
        if (!aliveRef.current) return;
        setEvents(next);
        setLastLoaded(Date.now());
        setConnected(true);
        setWantConnected(true);
        setError('');
      } catch (e) {
        if (!aliveRef.current) return;
        setError(e instanceof Error ? e.message : 'Could not load calendar');
        // A silent attempt failing means the Google session is gone; stop
        // retrying on every poll and let the user reconnect deliberately.
        setConnected(false);
        if (!interactive) setWantConnected(false);
      } finally {
        busyRef.current = false;
        if (aliveRef.current) setLoading(false);
      }
    },
    [setWantConnected],
  );

  const connect = useCallback(() => void load(true), [load]);
  const refresh = useCallback(() => void load(false), [load]);

  const disconnect = useCallback(() => {
    // Deliberately does *not* call `clearAccessToken()`. That cache is a single
    // shared token (one scope, per `googleAuth.ts`), so clearing it here would
    // also cut off Reminders sync. The token is memory-only and dies with the
    // tab; this hook simply stops using it. Plan Phase 1's per-scope cache is
    // what makes a real per-product disconnect possible.
    setConnected(false);
    setWantConnected(false);
    setEvents([]);
    setError('');
  }, [setWantConnected]);

  // On mount: reconnect silently if the user was connected before.
  useEffect(() => {
    if (configured && wantConnected) void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll while connected, and refresh when the tab regains focus.
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => void load(false), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [connected, load]);

  return {
    configured,
    connected,
    loading,
    error,
    events,
    now,
    lastLoaded,
    connect,
    disconnect,
    refresh,
  };
}
