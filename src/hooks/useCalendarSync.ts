import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { clearAccessToken, hasGoogleClientId } from '../lib/googleAuth';
import { runSync, type Reminder } from '../lib/gcalSync';

/** Auto-sync cadence while connected (ms). */
const POLL_MS = 60_000;
/** Debounce for syncs triggered by local edits (ms). */
const DEBOUNCE_MS = 2_500;

/** What {@link useCalendarSync} exposes to the widget. */
export interface CalendarSync {
  /** A Google client id is configured (feature is available at all). */
  configured: boolean;
  /**
   * Syncing, as far as we know.
   *
   * Optimistic on mount: a returning user starts out `true` on the strength of
   * the stored intent, before the silent token request that backs it up has
   * finished. It drops back to `false` if that request fails. Showing a Connect
   * button for the second it takes to renew a token would read as being signed
   * out, which is exactly the thing this hook is trying not to do.
   */
  connected: boolean;
  /** A sync cycle is in flight. */
  syncing: boolean;
  /** Last error message, or '' if none. */
  error: string;
  /** Begin syncing — opens the Google consent popup (call from a click). */
  connect: () => void;
  /** Stop syncing and forget the in-memory token. */
  disconnect: () => void;
  /** Trigger a background sync (coalesced); safe to call after local edits. */
  syncNow: () => void;
}

/**
 * Drives two-way sync between the reminder list and Google Calendar.
 *
 * The widget keeps owning its reminders via `useLocalStorage`; this hook reads
 * them through `getReminders` (so it always sees the latest) and writes the
 * reconciled result through `setReminders`. The calendar id and sync token
 * persist to `localStorage`; the access token never does.
 *
 * @param getReminders - Returns the current reminders at call time.
 * @param setReminders - Replaces the reminder list with the reconciled result.
 */
export function useCalendarSync(
  getReminders: () => Reminder[],
  setReminders: (next: Reminder[]) => void,
): CalendarSync {
  const configured = hasGoogleClientId();
  const [calendarId, setCalendarId] = useLocalStorage<string>('gcal.calendarId', '');
  const [syncToken, setSyncToken] = useLocalStorage<string>('gcal.syncToken', '');
  // Remember intent across reloads so we can silently reconnect.
  const [wantConnected, setWantConnected] = useLocalStorage<boolean>('gcal.connected', false);

  // Seeded from the stored intent — see `CalendarSync.connected`.
  const [connected, setConnected] = useState(wantConnected);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  // Keep the newest callbacks/values in refs so the effects below stay stable.
  const getRef = useRef(getReminders);
  const setRef = useRef(setReminders);
  const calRef = useRef(calendarId);
  const tokRef = useRef(syncToken);
  useEffect(() => {
    getRef.current = getReminders;
    setRef.current = setReminders;
    calRef.current = calendarId;
    tokRef.current = syncToken;
  });

  const busyRef = useRef(false);
  const rerunRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Whether a sync has actually succeeded since this hook mounted.
   *
   * Until one has, `connected` is only the optimistic guess above, so a failure
   * has to walk it back. Once a run has proved we hold a token, a later failure
   * is a blip — a dropped network, a rate limit — and disconnecting over it
   * would throw away a working session.
   */
  const provenRef = useRef(false);

  const runOnce = useCallback(
    async (interactive: boolean) => {
      if (!hasGoogleClientId()) return;
      if (busyRef.current) {
        rerunRef.current = true; // fold this request into a follow-up run
        return;
      }
      busyRef.current = true;
      setSyncing(true);
      try {
        const res = await runSync({
          interactive,
          reminders: getRef.current(),
          calendarId: calRef.current || undefined,
          syncToken: tokRef.current || undefined,
          now: Date.now(),
        });
        setRef.current(res.reminders);
        setCalendarId(res.calendarId);
        setSyncToken(res.syncToken ?? '');
        provenRef.current = true;
        setConnected(true);
        setWantConnected(true);
        setError('');
      } catch (e) {
        // Stay quiet about a background reconnect that could not get a token:
        // there is nothing the user can do about a blocked third-party cookie,
        // and an error under the reminder list implies they broke something.
        // Once they have asked (interactive), or once a proven session starts
        // failing, the failure is worth saying out loud.
        if (interactive || provenRef.current) {
          setError(e instanceof Error ? e.message : 'Sync failed');
        }
        // Nothing has proved we hold a token, so the optimism was misplaced.
        if (!provenRef.current) setConnected(false);
      } finally {
        busyRef.current = false;
        setSyncing(false);
        if (rerunRef.current) {
          rerunRef.current = false;
          void runOnce(false);
        }
      }
    },
    [setCalendarId, setSyncToken, setWantConnected],
  );

  const connect = useCallback(() => void runOnce(true), [runOnce]);

  const disconnect = useCallback(() => {
    clearAccessToken();
    provenRef.current = false;
    setConnected(false);
    setWantConnected(false);
  }, [setWantConnected]);

  const syncNow = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runOnce(false), DEBOUNCE_MS);
  }, [runOnce]);

  // On mount: if the user was connected before, try to reconnect silently.
  useEffect(() => {
    if (configured && wantConnected) void runOnce(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Returning to the tab is a chance to heal a reconnect that failed earlier: a
  // machine that woke from sleep, or a Google session signed back in since, will
  // now hand over a token where minutes ago it would not. Only worth doing while
  // we are meant to be connected but aren't — the poll below covers the rest.
  useEffect(() => {
    if (!configured || !wantConnected || connected) return;
    const retry = () => {
      if (document.visibilityState === 'visible') void runOnce(false);
    };
    document.addEventListener('visibilitychange', retry);
    return () => document.removeEventListener('visibilitychange', retry);
  }, [configured, wantConnected, connected, runOnce]);

  // Poll while connected.
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => void runOnce(false), POLL_MS);
    return () => clearInterval(id);
  }, [connected, runOnce]);

  return { configured, connected, syncing, error, connect, disconnect, syncNow };
}
