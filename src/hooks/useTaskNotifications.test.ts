import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTaskNotifications } from './useTaskNotifications';
import { GRACE_MS, noticeKey } from '../lib/notifications';
import type { AgendaItem } from '../lib/agenda';

const MINUTE = 60_000;
const NOW = new Date('2026-08-06T09:00:00').getTime();

/** Where the choice and the ledger of raised notices are stored. */
const ENABLED_KEY = 'notify.tasks';
const LEDGER_KEY = 'notify.sent';

/** Every notification constructed during a test, oldest first. */
let notificationsShown: { title: string; options?: NotificationOptions }[] = [];

/** The stub's answer to `Notification.permission`. */
let currentPermission: NotificationPermission = 'granted';

/** What the next `requestPermission()` resolves to. */
let permissionWhenAsked: NotificationPermission = 'granted';

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
      notificationsShown.push({ title, options });
    }
    close = vi.fn();
    static get permission() {
      return currentPermission;
    }
    static requestPermission = requestPermission;
  }
  vi.stubGlobal('Notification', FakeNotification);
}

/** An agenda item for a task, defaulting to one due exactly now. */
function task(overrides: Partial<AgendaItem> & { id?: string } = {}): AgendaItem {
  const id = overrides.id ?? 't1';
  const start = overrides.start ?? NOW;
  return {
    key: `task:${id}`,
    source: 'task',
    id,
    title: 'Water the plants',
    start,
    end: start,
    allDay: false,
    done: false,
    ...overrides,
  };
}

/** Mounts the hook with the feature already switched on. */
function renderWithNotificationsOn(items: AgendaItem[] = [], now = NOW) {
  localStorage.setItem(ENABLED_KEY, JSON.stringify(true));
  return renderHook(
    ({ items: currentItems, now: currentNow }) => useTaskNotifications(currentItems, currentNow),
    { initialProps: { items, now } },
  );
}

/** Ticks the hook forward with a new agenda and clock. */
const tick = (
  view: ReturnType<typeof renderWithNotificationsOn>,
  items: AgendaItem[],
  now: number,
) => view.rerender({ items, now });

/** The keys the hook has recorded as already raised. */
function ledger(): string[] {
  return JSON.parse(localStorage.getItem(LEDGER_KEY) ?? '[]');
}

/** The stored on/off choice, as written. */
const storedEnabled = () => localStorage.getItem(ENABLED_KEY);

/** Returns to a tab that was frozen at `NOW`, with the real clock moved on. */
function returnToTabAt(now: number) {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
}

beforeEach(() => {
  notificationsShown = [];
  currentPermission = 'granted';
  permissionWhenAsked = 'granted';
  requestPermission.mockImplementation(() => {
    currentPermission = permissionWhenAsked;
    return Promise.resolve(permissionWhenAsked);
  });
  stubNotification();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTaskNotifications support', () => {
  it('is unavailable where the browser has no Notification API', () => {
    vi.stubGlobal('Notification', undefined);

    const { result } = renderHook(() => useTaskNotifications([], NOW));

    expect(result.current.supported).toBe(false);
    expect(result.current.active).toBe(false);
  });

  it('is available where the API exists', () => {
    const { result } = renderHook(() => useTaskNotifications([], NOW));

    expect(result.current.supported).toBe(true);
  });

  it('reports a refused grant as blocked', () => {
    currentPermission = 'denied';

    const { result } = renderHook(() => useTaskNotifications([], NOW));

    expect(result.current.blocked).toBe(true);
    expect(result.current.active).toBe(false);
  });
});

describe('the task-notification setting', () => {
  it('is off until the user turns it on', () => {
    const { result } = renderHook(() => useTaskNotifications([], NOW));

    expect(result.current.active).toBe(false);
  });

  it('does not ask for permission just because the dashboard loaded', () => {
    currentPermission = 'default';

    renderHook(() => useTaskNotifications([task()], NOW));

    expect(requestPermission).not.toHaveBeenCalled();
    expect(notificationsShown).toEqual([]);
  });

  it('asks for permission when switched on, and turns on once granted', async () => {
    currentPermission = 'default';
    const { result } = renderHook(() => useTaskNotifications([], NOW));

    act(() => result.current.setEnabled(true));

    await waitFor(() => expect(result.current.active).toBe(true));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(storedEnabled()).toBe(JSON.stringify(true));
  });

  it('stays off when permission is refused', async () => {
    currentPermission = 'default';
    permissionWhenAsked = 'denied';
    const { result } = renderHook(() => useTaskNotifications([], NOW));

    act(() => result.current.setEnabled(true));

    await waitFor(() => expect(result.current.blocked).toBe(true));
    expect(result.current.active).toBe(false);
    expect(storedEnabled()).toBe(JSON.stringify(false));
  });

  it('does not ask again when permission is already held', () => {
    const { result } = renderHook(() => useTaskNotifications([], NOW));

    act(() => result.current.setEnabled(true));

    expect(requestPermission).not.toHaveBeenCalled();
    expect(result.current.active).toBe(true);
  });

  it('persists the choice across a reload', () => {
    const { result } = renderWithNotificationsOn();

    expect(result.current.active).toBe(true);
  });

  it('reads a corrupt stored value as off', () => {
    localStorage.setItem(ENABLED_KEY, '{not json');

    const { result } = renderHook(() => useTaskNotifications([], NOW));

    expect(result.current.active).toBe(false);
  });

  it('goes quiet again when switched off', () => {
    const view = renderWithNotificationsOn([]);

    act(() => view.result.current.setEnabled(false));
    tick(view, [task()], NOW);

    expect(notificationsShown).toEqual([]);
    expect(storedEnabled()).toBe(JSON.stringify(false));
  });
});

describe('raising a task notice', () => {
  it('shows one when a task comes due', () => {
    renderWithNotificationsOn([task()]);

    expect(notificationsShown).toHaveLength(1);
    expect(notificationsShown[0].title).toBe('Water the plants');
    expect(notificationsShown[0].options?.body).toBe('Due now');
  });

  it('tags it with the ledger key, so the OS de-dupes it too', () => {
    const item = task();

    renderWithNotificationsOn([item]);

    expect(notificationsShown[0].options?.tag).toBe(noticeKey(item));
  });

  it('shows nothing while the feature is off', () => {
    renderHook(() => useTaskNotifications([task()], NOW));

    expect(notificationsShown).toEqual([]);
  });

  it('shows nothing without a grant, even when switched on', () => {
    currentPermission = 'denied';

    renderWithNotificationsOn([task()]);

    expect(notificationsShown).toEqual([]);
  });

  it('raises a task that falls due while the dashboard is open', () => {
    const dueSoon = task({ start: NOW + 5 * MINUTE });
    const view = renderWithNotificationsOn([dueSoon]);
    expect(notificationsShown).toEqual([]);

    tick(view, [dueSoon], NOW + 5 * MINUTE);

    expect(notificationsShown).toHaveLength(1);
  });

  it('raises a task the moment it is given a due time in the recent past', () => {
    const view = renderWithNotificationsOn([]);

    tick(view, [task({ start: NOW - MINUTE })], NOW);

    expect(notificationsShown).toHaveLength(1);
    expect(notificationsShown[0].options?.body).toBe('Due 1m ago');
  });

  it('does not repeat itself on the next tick', () => {
    const items = [task()];
    const view = renderWithNotificationsOn(items);
    expect(notificationsShown).toHaveLength(1);

    tick(view, items, NOW + MINUTE);
    tick(view, items, NOW + 2 * MINUTE);

    expect(notificationsShown).toHaveLength(1);
  });

  it('does not repeat itself after a reload', () => {
    const items = [task()];
    renderWithNotificationsOn(items).unmount();
    expect(notificationsShown).toHaveLength(1);

    renderWithNotificationsOn(items);

    expect(notificationsShown).toHaveLength(1);
  });

  it('raises it again once the task is moved to a new time', () => {
    const view = renderWithNotificationsOn([task()]);
    expect(notificationsShown).toHaveLength(1);

    tick(view, [task({ start: NOW + 10 * MINUTE })], NOW + 10 * MINUTE);

    expect(notificationsShown).toHaveLength(2);
  });
});

describe('returning to a tab that was not being watched', () => {
  it('catches up when the page becomes visible again', () => {
    renderWithNotificationsOn([task({ start: NOW + 20 * MINUTE })], NOW);
    expect(notificationsShown).toEqual([]);

    // The tab was frozen: no tick ever advanced `now`, so returning to the
    // page has to read the clock itself.
    returnToTabAt(NOW + 22 * MINUTE);

    expect(notificationsShown).toHaveLength(1);
    expect(notificationsShown[0].options?.body).toBe('Due 2m ago');
  });

  it('leaves last night alone rather than greeting the user with a backlog', () => {
    renderWithNotificationsOn([task({ start: NOW - GRACE_MS - MINUTE })]);

    expect(notificationsShown).toEqual([]);
  });

  it('stops listening once unmounted', () => {
    const { unmount } = renderWithNotificationsOn([task({ start: NOW + 20 * MINUTE })], NOW);

    unmount();
    returnToTabAt(NOW + 22 * MINUTE);

    expect(notificationsShown).toEqual([]);
  });
});

describe('the ledger of raised notices', () => {
  it('records what it has raised', () => {
    const item = task();

    renderWithNotificationsOn([item]);

    expect(ledger()).toEqual([noticeKey(item)]);
  });

  it('forgets entries too old to ever fire again', () => {
    const stale = `task:old@${NOW - GRACE_MS - MINUTE}`;
    localStorage.setItem(LEDGER_KEY, JSON.stringify([stale]));

    renderWithNotificationsOn([task()]);

    expect(ledger()).not.toContain(stale);
  });

  it('settles rather than writing on every quiet tick', () => {
    const items = [task()];
    const view = renderWithNotificationsOn(items);
    const write = vi.spyOn(window.localStorage, 'setItem');

    tick(view, items, NOW + MINUTE);
    tick(view, items, NOW + 2 * MINUTE);

    expect(write.mock.calls.filter(([key]) => key === LEDGER_KEY)).toEqual([]);
  });
});
