import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { pendingNotices, pruneSent } from '../lib/notifications';
import type { AgendaItem } from '../lib/agenda';

/** The browser's current grant, or `null` where the API does not exist at all. */
function readPermission(): NotificationPermission | null {
  return typeof Notification === 'undefined' ? null : Notification.permission;
}

/** What {@link useTaskNotifications} hands back. */
export interface TaskNotifications {
  /** Whether this browser can show notifications. iOS Safari cannot, outside a PWA. */
  supported: boolean;
  /** Whether notices are actually being delivered: switched on *and* permitted. */
  active: boolean;
  /**
   * Permission was refused, so this page cannot ask again — only the browser's
   * own site settings can undo it. The switch says so rather than silently
   * failing to turn on.
   */
  blocked: boolean;
  /** Records a new choice, asking the browser for permission the first time. */
  setEnabled: (next: boolean) => void;
}

/**
 * Raises a browser notification when a dated task comes due.
 *
 * Which tasks and what they say is decided by `lib/notifications.ts`; what is
 * here is the two things that cannot be pure — the permission grant, and a
 * schedule that survives the tab not being looked at.
 *
 * **Why there is no timer of its own.** The obvious implementation, a
 * `setTimeout` per task, is the one thing that cannot work: browsers throttle
 * timers in a background tab and drop them entirely from a frozen or discarded
 * one, which is exactly the tab a notification exists to reach. So this polls
 * instead, on two beats — the dashboard's existing minute tick while the page is
 * alive, and a re-check the moment the page becomes visible again. Neither is
 * punctual on its own, which is what `GRACE_MS` is for: between them a task that
 * came due while the tab slept is still raised when the user comes back, and one
 * that came due last night is not.
 *
 * **Why the ledger is persisted.** A reload would otherwise re-raise everything
 * still inside the grace window. Keys pair the task with its due time, so
 * rescheduling a task arms it again rather than being swallowed by the record of
 * the old time having fired.
 *
 * Neither key is synced to the account (`profileSync.SHARED_KEYS`). A permission
 * grant belongs to one browser on one device, so a preference that outran it
 * would claim to be on where it cannot possibly deliver — and the ledger is a
 * record of what *this* browser has already shown.
 *
 * Owned by `DashboardDataProvider` and read through `useDashboardData`, for the
 * reason that context exists: `useLocalStorage` has no cross-instance sync, so a
 * second copy of this hook in the settings menu would keep its own idea of
 * whether the feature is on.
 *
 * @param items - The merged agenda. Only its tasks are considered.
 * @param now - The dashboard's minute tick, used as the heartbeat.
 */
export function useTaskNotifications(items: AgendaItem[], now: number): TaskNotifications {
  const [enabled, setStored] = useLocalStorage<boolean>('notify.tasks', false);
  const [sent, setSent] = useLocalStorage<string[]>('notify.sent', []);
  const [permission, setPermission] = useState(readPermission);

  const supported = permission !== null;
  const active = enabled && permission === 'granted';
  const blocked = permission === 'denied';

  // A grant can be revoked from the browser's own site settings, with no reload.
  // Without this the switch would sit permanently disabled after the user had
  // already unblocked it — a dead end of exactly the kind US-12 rules out.
  useEffect(() => {
    if (!supported || !navigator.permissions?.query) return;
    let alive = true;
    let status: PermissionStatus | null = null;
    const onChange = () => setPermission(readPermission());

    navigator.permissions
      .query({ name: 'notifications' as PermissionName })
      .then((result) => {
        if (!alive) return;
        status = result;
        result.addEventListener('change', onChange);
      })
      .catch(() => {
        // Not every browser exposes a 'notifications' descriptor. The switch
        // then learns about an outside change on the next reload instead.
      });

    return () => {
      alive = false;
      status?.removeEventListener('change', onChange);
    };
  }, [supported]);

  const setEnabled = useCallback(
    (next: boolean) => {
      if (!next || typeof Notification === 'undefined') {
        setStored(false);
        return;
      }
      if (Notification.permission === 'granted') {
        setStored(true);
        return;
      }
      // The click that reached here is the user gesture the prompt needs. Asking
      // on load instead is what gets an origin permanently blocked.
      void (async () => {
        let result: NotificationPermission = 'default';
        try {
          result = await Notification.requestPermission();
        } catch {
          // Some browsers reject rather than resolve when the prompt is dismissed.
        }
        setPermission(result);
        setStored(result === 'granted');
      })();
    },
    [setStored],
  );

  const fire = useCallback(
    (at: number) => {
      if (!active) return;
      const due = pendingNotices(items, at, sent);
      const kept = pruneSent(sent, at);

      if (due.length === 0) {
        // Housekeeping only. Guarded so a quiet minute is not a storage write.
        if (kept.length !== sent.length) setSent(kept);
        return;
      }

      for (const notice of due) {
        try {
          const note = new Notification(notice.title, { body: notice.body, tag: notice.key });
          note.onclick = () => {
            window.focus();
            note.close();
          };
        } catch {
          // Android Chrome only allows notifications from a service worker and
          // throws here. There is nothing to fall back to, and the ledger below
          // still records the attempt so this does not retry every minute.
        }
      }
      setSent([...kept, ...due.map((notice) => notice.key)]);
    },
    [active, items, sent, setSent],
  );

  // The heartbeat. Also re-checks whenever the task list changes, so a task
  // saved with a due time in the last few minutes is raised without waiting.
  useEffect(() => {
    fire(now);
  }, [fire, now]);

  const fireRef = useRef(fire);
  useEffect(() => {
    fireRef.current = fire;
  }, [fire]);

  // The catch-up. A tab that was frozen has a stale `now` and no pending tick,
  // so coming back has to measure the clock itself rather than trust the beat.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') fireRef.current(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return { supported, active, blocked, setEnabled };
}
