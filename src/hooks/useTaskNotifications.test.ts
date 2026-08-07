import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTaskNotifications } from './useTaskNotifications';
import { GRACE_MS, noticeKey } from '../lib/notifications';
import type { AgendaItem } from '../lib/agenda';

const MINUTE = 60_000;
const NOW = new Date('2026-08-06T09:00:00').getTime();

/** Every notification constructed during a test, oldest first. */
let shown: { title: string; options?: NotificationOptions }[] = [];

/** The stub's answer to `Notification.permission`. */
let granted: NotificationPermission = 'granted';

/** What the next `requestPermission()` resolves to. */
let asked: NotificationPermission = 'granted';

/**
 * Calls to `requestPermission`, to prove the prompt is only raised on a click.
 * Its implementation is reinstated in `beforeEach`, because `restoreMocks`
 * strips it between tests.
 */
const requestPermission = vi.fn<() => Promise<NotificationPermission>>();

/**
 * Installs a `Notification` constructor jsdom does not provide.
 *
 * A class rather than a `vi.fn`, because the hook constructs it with `new` and
 * then assigns `onclick` to the instance.
 */
function stubNotification() {
  class FakeNotification {
    onclick: (() => void) | null = null;
    constructor(title: string, options?: NotificationOptions) {
      shown.push({ title, options });
    }
    close = vi.fn();
    static get permission() {
      return granted;
    }
    static requestPermission = requestPermission;
  }
  vi.stubGlobal('Notification', FakeNotification);
}

/** An agenda item for a task, defaulting to one due exactly now. */
function task(over: Partial<AgendaItem> & { id?: string } = {}): AgendaItem {
  const id = over.id ?? 't1';
  const start = over.start ?? NOW;
  return {
    key: `task:${id}`,
    source: 'task',
    id,
    title: 'Water the plants',
    start,
    end: start,
    allDay: false,
    done: false,
    ...over,
  };
}

/** Mounts the hook with the feature already switched on and permitted. */
function setupOn(items: AgendaItem[] = [], now = NOW) {
  localStorage.setItem('notify.tasks', JSON.stringify(true));
  return renderHook(({ i, n }: { i: AgendaItem[]; n: number }) => useTaskNotifications(i, n), {
    initialProps: { i: items, n: now },
  });
}

/** The keys the hook has recorded as already raised. */
function ledger(): string[] {
  return JSON.parse(localStorage.getItem('notify.sent') ?? '[]');
}

beforeEach(() => {
  shown = [];
  granted = 'granted';
  asked = 'granted';
  requestPermission.mockImplementation(() => {
    granted = asked;
    return Promise.resolve(asked);
  });
  stubNotification();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTaskNotifications', () => {
  describe('support', () => {
    it('is unavailable where the browser has no Notification API', () => {
      vi.stubGlobal('Notification', undefined);

      const { result } = renderHook(() => useTaskNotifications([], NOW));

      expect(result.current.supported).toBe(false);
      expect(result.current.active).toBe(false);
    });

    it('is available where it exists', () => {
      const { result } = renderHook(() => useTaskNotifications([], NOW));

      expect(result.current.supported).toBe(true);
    });

    it('reports a refused grant as blocked', () => {
      granted = 'denied';

      const { result } = renderHook(() => useTaskNotifications([], NOW));

      expect(result.current.blocked).toBe(true);
      expect(result.current.active).toBe(false);
    });
  });

  describe('the setting', () => {
    it('is off until the user turns it on', () => {
      const { result } = renderHook(() => useTaskNotifications([], NOW));

      expect(result.current.active).toBe(false);
    });

    it('does not ask for permission just because the dashboard loaded', () => {
      granted = 'default';

      renderHook(() => useTaskNotifications([task()], NOW));

      expect(requestPermission).not.toHaveBeenCalled();
      expect(shown).toEqual([]);
    });

    it('asks for permission when switched on, and turns on once granted', async () => {
      granted = 'default';
      const { result } = renderHook(() => useTaskNotifications([], NOW));

      act(() => result.current.setEnabled(true));

      await waitFor(() => expect(result.current.active).toBe(true));
      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('notify.tasks')).toBe(JSON.stringify(true));
    });

    it('stays off when permission is refused', async () => {
      granted = 'default';
      asked = 'denied';
      const { result } = renderHook(() => useTaskNotifications([], NOW));

      act(() => result.current.setEnabled(true));

      await waitFor(() => expect(result.current.blocked).toBe(true));
      expect(result.current.active).toBe(false);
      expect(localStorage.getItem('notify.tasks')).toBe(JSON.stringify(false));
    });

    it('does not ask again when permission is already held', () => {
      const { result } = renderHook(() => useTaskNotifications([], NOW));

      act(() => result.current.setEnabled(true));

      expect(requestPermission).not.toHaveBeenCalled();
      expect(result.current.active).toBe(true);
    });

    it('persists the choice across a reload', () => {
      const { result } = setupOn();

      expect(result.current.active).toBe(true);
    });

    it('survives a corrupt stored value', () => {
      localStorage.setItem('notify.tasks', '{not json');

      const { result } = renderHook(() => useTaskNotifications([], NOW));

      expect(result.current.active).toBe(false);
    });

    it('goes quiet again when switched off', () => {
      const { result, rerender } = setupOn([]);

      act(() => result.current.setEnabled(false));
      rerender({ i: [task()], n: NOW });

      expect(shown).toEqual([]);
      expect(localStorage.getItem('notify.tasks')).toBe(JSON.stringify(false));
    });
  });

  describe('raising a notice', () => {
    it('shows one when a task comes due', () => {
      setupOn([task()]);

      expect(shown).toHaveLength(1);
      expect(shown[0].title).toBe('Water the plants');
      expect(shown[0].options?.body).toBe('Due now');
    });

    it('tags it with the ledger key, so the OS de-dupes it too', () => {
      const item = task();
      setupOn([item]);

      expect(shown[0].options?.tag).toBe(noticeKey(item));
    });

    it('shows nothing while the feature is off', () => {
      renderHook(() => useTaskNotifications([task()], NOW));

      expect(shown).toEqual([]);
    });

    it('shows nothing without a grant, even when switched on', () => {
      granted = 'denied';

      setupOn([task()]);

      expect(shown).toEqual([]);
    });

    it('raises a task that falls due while the dashboard is open', () => {
      const { rerender } = setupOn([task({ start: NOW + 5 * MINUTE })]);
      expect(shown).toEqual([]);

      rerender({ i: [task({ start: NOW + 5 * MINUTE })], n: NOW + 5 * MINUTE });

      expect(shown).toHaveLength(1);
    });

    it('raises a task the moment it is given a due time in the recent past', () => {
      const { rerender } = setupOn([]);

      rerender({ i: [task({ start: NOW - MINUTE })], n: NOW });

      expect(shown).toHaveLength(1);
      expect(shown[0].options?.body).toBe('Due 1m ago');
    });

    it('does not repeat itself on the next tick', () => {
      const items = [task()];
      const { rerender } = setupOn(items);
      expect(shown).toHaveLength(1);

      rerender({ i: items, n: NOW + MINUTE });
      rerender({ i: items, n: NOW + 2 * MINUTE });

      expect(shown).toHaveLength(1);
    });

    it('does not repeat itself after a reload', () => {
      const items = [task()];
      setupOn(items).unmount();
      expect(shown).toHaveLength(1);

      setupOn(items);

      expect(shown).toHaveLength(1);
    });

    it('raises it again once the task is moved to a new time', () => {
      const { rerender } = setupOn([task()]);
      expect(shown).toHaveLength(1);

      const moved = task({ start: NOW + 10 * MINUTE });
      rerender({ i: [moved], n: NOW + 10 * MINUTE });

      expect(shown).toHaveLength(2);
    });
  });

  describe('a tab that was not being watched', () => {
    it('catches up when the page becomes visible again', () => {
      const item = task({ start: NOW + 20 * MINUTE });
      setupOn([item], NOW);
      expect(shown).toEqual([]);

      // The tab was frozen: no tick ever advanced `now`, so returning to the
      // page has to read the clock itself.
      vi.spyOn(Date, 'now').mockReturnValue(NOW + 22 * MINUTE);
      act(() => document.dispatchEvent(new Event('visibilitychange')));

      expect(shown).toHaveLength(1);
      expect(shown[0].options?.body).toBe('Due 2m ago');
    });

    it('leaves last night alone rather than greeting the user with a backlog', () => {
      setupOn([task({ start: NOW - GRACE_MS - MINUTE })]);

      expect(shown).toEqual([]);
    });

    it('stops listening once unmounted', () => {
      const item = task({ start: NOW + 20 * MINUTE });
      const { unmount } = setupOn([item], NOW);

      unmount();
      vi.spyOn(Date, 'now').mockReturnValue(NOW + 22 * MINUTE);
      act(() => document.dispatchEvent(new Event('visibilitychange')));

      expect(shown).toEqual([]);
    });
  });

  describe('the ledger', () => {
    it('records what it has raised', () => {
      const item = task();
      setupOn([item]);

      expect(ledger()).toEqual([noticeKey(item)]);
    });

    it('forgets entries too old to ever fire again', () => {
      const stale = `task:old@${NOW - GRACE_MS - MINUTE}`;
      localStorage.setItem('notify.sent', JSON.stringify([stale]));

      setupOn([task()]);

      expect(ledger()).not.toContain(stale);
    });

    it('settles rather than writing on every quiet tick', () => {
      const items = [task()];
      const { rerender } = setupOn(items);
      const write = vi.spyOn(window.localStorage, 'setItem');

      rerender({ i: items, n: NOW + MINUTE });
      rerender({ i: items, n: NOW + 2 * MINUTE });

      expect(write.mock.calls.filter(([key]) => key === 'notify.sent')).toEqual([]);
    });
  });
});
