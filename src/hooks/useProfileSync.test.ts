import { createElement } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useProfileSync, type SyncUser } from './useProfileSync';
import { StorageScopeProvider, useLocalStorage } from './useLocalStorage';
import { METADATA_KEY, markLocal, type ProfileSnapshot } from '../lib/profileSync';

const ID = 'user_abc';
const at = (key: string) => `${ID}:${key}`;

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

/** The snapshot the fake account was last asked to store. */
function stored(user: { update: ReturnType<typeof vi.fn> }): ProfileSnapshot {
  const calls = user.update.mock.calls;
  return calls[calls.length - 1][0].unsafeMetadata[METADATA_KEY];
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('useProfileSync — signed out', () => {
  it('reports itself off and never touches an account', () => {
    const { result } = renderHook(() => useProfileSync(null));
    expect(result.current.status).toBe('off');
  });
});

describe('useProfileSync — hydration', () => {
  it('pulls the account’s dashboard into an empty browser before widgets mount', async () => {
    const remote: ProfileSnapshot = {
      v: 1,
      updatedAt: 900,
      data: { 'youtube.sources': '[{"id":"1","label":"From my account"}]' },
    };
    const user = fakeUser({ [METADATA_KEY]: remote });

    renderHook(() => useProfileSync(user));

    // Synchronous on purpose: storage is already correct by the time render
    // returns, so no widget can persist a default over the real data.
    expect(localStorage.getItem(at('youtube.sources'))).toBe(remote.data['youtube.sources']);
  });

  it('pushes this browser up when the account has nothing yet', async () => {
    localStorage.setItem(at('notes.text'), '"local note"');
    markLocal(ID, 500);
    const user = fakeUser({});

    renderHook(() => useProfileSync(user));

    await waitFor(() => expect(user.update).toHaveBeenCalled());
    expect(stored(user).data['notes.text']).toBe('"local note"');
  });

  it('keeps the newer local dashboard instead of an older account copy', async () => {
    localStorage.setItem(at('notes.text'), '"newer local"');
    markLocal(ID, 9000);
    const user = fakeUser({
      [METADATA_KEY]: { v: 1, updatedAt: 100, data: { 'notes.text': '"older remote"' } },
    });

    renderHook(() => useProfileSync(user));

    expect(localStorage.getItem(at('notes.text'))).toBe('"newer local"');
    await waitFor(() => expect(user.update).toHaveBeenCalled());
    expect(stored(user).data['notes.text']).toBe('"newer local"');
  });

  it('ignores unreadable account metadata rather than wiping the browser', async () => {
    localStorage.setItem(at('notes.text'), '"local"');
    markLocal(ID, 10);
    const user = fakeUser({ [METADATA_KEY]: { v: 99, junk: true } });

    renderHook(() => useProfileSync(user));

    expect(localStorage.getItem(at('notes.text'))).toBe('"local"');
  });
});

describe('useProfileSync — failures', () => {
  it('reports an over-budget dashboard instead of silently dropping it', async () => {
    localStorage.setItem(at('notes.text'), JSON.stringify('x'.repeat(9000)));
    markLocal(ID, 500);
    const user = fakeUser({});

    const { result } = renderHook(() => useProfileSync(user));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/notes\.text/);
    expect(result.current.error).toMatch(/still saved in this browser/i);
    // Refused, not truncated — a partial write would lose data server-side.
    expect(user.update).not.toHaveBeenCalled();
  });

  it('surfaces a rejected account write', async () => {
    localStorage.setItem(at('notes.text'), '"note"');
    markLocal(ID, 500);
    const user = fakeUser({});
    user.update.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useProfileSync(user));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/network down/);
  });
});

describe('useProfileSync — pushing changes', () => {
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
      {
        wrapper: ({ children }) =>
          createElement(StorageScopeProvider, { value: ID }, children),
      },
    );
  }

  // These wait out the real 1500ms debounce, so they need more than vitest's
  // 5s default budget.
  it('saves a later edit to the account', async () => {
    localStorage.setItem(at('notes.text'), '"first"');
    markLocal(ID, 500);
    const user = fakeUser({});

    const { result } = renderDashboardEdit(user);

    // The setter takes the value; useLocalStorage does the JSON encoding, which
    // is why the stored form gains the quotes.
    act(() => result.current.setNotes('typed on this device'));

    await waitFor(() => expect(stored(user).data['notes.text']).toBe('"typed on this device"'), {
      timeout: 8000,
    });
  }, 15000);

  it('collapses a burst of edits into a single account write', async () => {
    localStorage.setItem(at('notes.text'), '"first"');
    markLocal(ID, 500);
    const user = fakeUser({});

    const { result } = renderDashboardEdit(user);
    const before = user.update.mock.calls.length;

    // What typing looks like: many writes, well inside the debounce window.
    act(() => {
      result.current.setNotes('a');
    });
    act(() => {
      result.current.setNotes('ab');
    });
    act(() => {
      result.current.setNotes('abc');
    });

    await waitFor(() => expect(stored(user).data['notes.text']).toBe('"abc"'), { timeout: 8000 });
    expect(user.update.mock.calls.length - before).toBe(1);
  }, 15000);

  it('does not push a key that stays on the device', async () => {
    localStorage.setItem(at('notes.text'), '"note"');
    markLocal(ID, 500);
    const user = fakeUser({});

    const { result } = renderHook(
      () => {
        const sync = useProfileSync(user);
        const [, setToken] = useLocalStorage<string>('gcal.syncToken', '');
        return { sync, setToken };
      },
      {
        wrapper: ({ children }) =>
          createElement(StorageScopeProvider, { value: ID }, children),
      },
    );
    // Let the initial push settle, so `before` is a stable baseline.
    await waitFor(() => expect(user.update).toHaveBeenCalled());
    const before = user.update.mock.calls.length;

    act(() => result.current.setToken('new cursor'));
    await new Promise((r) => setTimeout(r, 2500));

    expect(user.update.mock.calls.length).toBe(before);
  }, 15000);
});
