import { createElement, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useProfileSync, type SyncUser } from './useProfileSync';
import { StorageScopeProvider, useLocalStorage } from './useLocalStorage';
import { METADATA_KEY, markLocal, type ProfileSnapshot } from '../lib/profileSync';

const ID = 'user_abc';

/** A localStorage key inside the signed-in user's namespace. */
const scopedKey = (key: string) => `${ID}:${key}`;

/** Renders inside this user's storage scope, as `<AuthGate>` does. */
const inUserScope = ({ children }: { children: ReactNode }) =>
  createElement(StorageScopeProvider, { value: ID }, children);

/** A fake Clerk user whose metadata writes are observable. */
function fakeUser(metadata: unknown = {}): SyncUser & { update: ReturnType<typeof vi.fn> } {
  const user = {
    id: ID,
    unsafeMetadata: metadata,
    update: vi.fn(async (params: { unsafeMetadata: Record<string, unknown> }) => {
      user.unsafeMetadata = params.unsafeMetadata;
      return user;
    }),
  };
  return user;
}

/** A fake user whose account already holds `snapshot`. */
const userWithSnapshot = (snapshot: Partial<ProfileSnapshot>) =>
  fakeUser({ [METADATA_KEY]: { v: 2, updatedAt: 900, data: {}, devices: {}, ...snapshot } });

/** The snapshot the fake account was last asked to store. */
function snapshotStoredBy(user: { update: ReturnType<typeof vi.fn> }): ProfileSnapshot {
  const calls = user.update.mock.calls;
  return calls[calls.length - 1][0].unsafeMetadata[METADATA_KEY];
}

/** Gives this browser local data, stamped as changed at `changedAt`. */
function seedLocal(key: string, value: string, changedAt: number) {
  localStorage.setItem(scopedKey(key), value);
  markLocal(ID, changedAt);
}

/** Makes `detectFormFactor()` report a touch device for this test. */
function stubMobileDevice() {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) => ({ matches: query.includes('coarse') }) as MediaQueryList,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('useProfileSync when signed out', () => {
  it('reports itself off and never touches an account', () => {
    const { result } = renderHook(() => useProfileSync(null));

    expect(result.current.status).toBe('off');
  });
});

describe('useProfileSync on first render', () => {
  it('pulls the account’s dashboard into an empty browser before widgets mount', () => {
    const sources = '[{"id":"1","label":"From my account"}]';
    const user = userWithSnapshot({ data: { 'youtube.sources': sources } });

    renderHook(() => useProfileSync(user));

    // Synchronous on purpose: storage is already correct by the time render
    // returns, so no widget can persist a default over the real data.
    expect(localStorage.getItem(scopedKey('youtube.sources'))).toBe(sources);
  });

  it('pushes this browser up when the account has nothing yet', async () => {
    seedLocal('notes.text', '"local note"', 500);
    const user = fakeUser({});

    renderHook(() => useProfileSync(user));

    await waitFor(() => expect(user.update).toHaveBeenCalled());
    expect(snapshotStoredBy(user).data['notes.text']).toBe('"local note"');
  });

  it('keeps the newer local dashboard instead of an older account copy', () => {
    seedLocal('notes.text', '"newer local"', 9000);
    const user = userWithSnapshot({ updatedAt: 100, data: { 'notes.text': '"older remote"' } });

    renderHook(() => useProfileSync(user));

    expect(localStorage.getItem(scopedKey('notes.text'))).toBe('"newer local"');
  });

  it('pushes that newer local dashboard up to the account', async () => {
    seedLocal('notes.text', '"newer local"', 9000);
    const user = userWithSnapshot({ updatedAt: 100, data: { 'notes.text': '"older remote"' } });

    renderHook(() => useProfileSync(user));

    await waitFor(() => expect(user.update).toHaveBeenCalled());
    expect(snapshotStoredBy(user).data['notes.text']).toBe('"newer local"');
  });

  it('ignores unreadable account metadata rather than wiping the browser', () => {
    seedLocal('notes.text', '"local"', 10);
    const user = fakeUser({ [METADATA_KEY]: { v: 99, junk: true } });

    renderHook(() => useProfileSync(user));

    expect(localStorage.getItem(scopedKey('notes.text'))).toBe('"local"');
  });
});

describe('useProfileSync across desktop and mobile', () => {
  it('takes the mobile layout, not the desktop one, on a phone', () => {
    const user = userWithSnapshot({
      devices: {
        desktop: { data: { layout: '["reminders","calendar","news"]' } },
        mobile: { data: { layout: '["reminders"]' } },
      },
    });
    stubMobileDevice();

    renderHook(() => useProfileSync(user));

    expect(localStorage.getItem(scopedKey('layout'))).toBe('["reminders"]');
  });

  it('does not delete the desktop layout when a phone saves its own', async () => {
    // The account as a PC left it.
    const user = userWithSnapshot({
      updatedAt: 100,
      devices: { desktop: { data: { layout: '["reminders","calendar","news"]' } } },
    });
    // This phone has a newer arrangement of its own.
    seedLocal('layout', '["notes"]', 9000);
    stubMobileDevice();

    renderHook(() => useProfileSync(user));

    await waitFor(() => expect(user.update).toHaveBeenCalled());
    const saved = snapshotStoredBy(user);
    expect(saved.devices.mobile?.data['layout']).toBe('["notes"]');
    // The whole point of the split.
    expect(saved.devices.desktop?.data['layout']).toBe('["reminders","calendar","news"]');
  });

  it('still shares authored content across both', () => {
    const user = userWithSnapshot({
      data: { 'notes.text': '"written on the PC"' },
      devices: { desktop: { data: { layout: '["notes"]' } } },
    });
    stubMobileDevice();

    renderHook(() => useProfileSync(user));

    expect(localStorage.getItem(scopedKey('notes.text'))).toBe('"written on the PC"');
  });
});

describe('useProfileSync when a sync fails', () => {
  it('names the offending key when the dashboard is over budget', async () => {
    seedLocal('notes.text', JSON.stringify('x'.repeat(9000)), 500);
    const user = fakeUser({});

    const { result } = renderHook(() => useProfileSync(user));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/notes\.text/);
    expect(result.current.error).toMatch(/still saved in this browser/i);
  });

  it('refuses an over-budget write rather than truncating it', async () => {
    seedLocal('notes.text', JSON.stringify('x'.repeat(9000)), 500);
    const user = fakeUser({});

    const { result } = renderHook(() => useProfileSync(user));

    await waitFor(() => expect(result.current.status).toBe('error'));
    // A partial write would lose data server-side.
    expect(user.update).not.toHaveBeenCalled();
  });

  it('surfaces a rejected account write', async () => {
    seedLocal('notes.text', '"note"', 500);
    const user = fakeUser({});
    user.update.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useProfileSync(user));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/network down/);
  });
});

describe('useProfileSync pushing later changes', () => {
  /**
   * Drives sync the way the app does: a real `useLocalStorage` setter, whose
   * write is what announces the change. Poking `localStorage` directly would
   * prove nothing, since nothing would be listening.
   */
  function renderDashboardEdit(user: SyncUser) {
    return renderHook(
      () => {
        const sync = useProfileSync(user);
        const [notes, setNotes] = useLocalStorage<string>('notes.text', '');
        return { sync, notes, setNotes };
      },
      { wrapper: inUserScope },
    );
  }

  // These wait out the real 1500ms debounce, so they need more than vitest's
  // 5s default budget.
  it('saves a later edit to the account', async () => {
    seedLocal('notes.text', '"first"', 500);
    const user = fakeUser({});
    const { result } = renderDashboardEdit(user);

    // The setter takes the value; useLocalStorage does the JSON encoding, which
    // is why the stored form gains the quotes.
    act(() => result.current.setNotes('typed on this device'));

    await waitFor(
      () => expect(snapshotStoredBy(user).data['notes.text']).toBe('"typed on this device"'),
      { timeout: 8000 },
    );
  }, 15000);

  it('collapses a burst of edits into a single account write', async () => {
    seedLocal('notes.text', '"first"', 500);
    const user = fakeUser({});
    const { result } = renderDashboardEdit(user);
    const writesBefore = user.update.mock.calls.length;

    // What typing looks like: many writes, well inside the debounce window.
    act(() => result.current.setNotes('a'));
    act(() => result.current.setNotes('ab'));
    act(() => result.current.setNotes('abc'));

    await waitFor(() => expect(snapshotStoredBy(user).data['notes.text']).toBe('"abc"'), {
      timeout: 8000,
    });
    expect(user.update.mock.calls.length - writesBefore).toBe(1);
  }, 15000);

  it('does not push a key that stays on the device', async () => {
    seedLocal('notes.text', '"note"', 500);
    const user = fakeUser({});
    const { result } = renderHook(
      () => {
        const sync = useProfileSync(user);
        const [, setToken] = useLocalStorage<string>('gcal.syncToken', '');
        return { sync, setToken };
      },
      { wrapper: inUserScope },
    );
    // Let the initial push settle, so the baseline is stable.
    await waitFor(() => expect(user.update).toHaveBeenCalled());
    const writesBefore = user.update.mock.calls.length;

    act(() => result.current.setToken('new cursor'));
    await new Promise((resolve) => setTimeout(resolve, 2500));

    expect(user.update.mock.calls.length).toBe(writesBefore);
  }, 15000);
});
