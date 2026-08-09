import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCachedResource } from './useCachedResource';
import { peek, put } from '../lib/cache';

const MINUTE = 60_000;

/** The cache key most cases use. */
const KEY = 'weather';

/** A promise whose settlement the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Ages a key's cached entry past `ttlMs` without touching the clock. */
function putStale(key: string, value: unknown, ttlMs = MINUTE) {
  put(key, value);
  const entry = peek(key)!;
  entry.at = Date.now() - ttlMs - 1;
}

describe('useCachedResource with nothing cached', () => {
  it('starts in loading', () => {
    const { result } = renderHook(() => useCachedResource(KEY, MINUTE, () => Promise.resolve(1)));

    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('settles on the loaded value', async () => {
    const { result } = renderHook(() => useCachedResource(KEY, MINUTE, () => Promise.resolve(1)));

    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.data).toBe(1);
  });

  it('reports an error when the load fails and there is nothing to show', async () => {
    const { result } = renderHook(() =>
      useCachedResource(KEY, MINUTE, () => Promise.reject(new Error('offline'))),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.data).toBeNull();
    expect(result.current.error?.message).toBe('offline');
  });
});

describe('useCachedResource with a fresh cached value', () => {
  it('paints the cached data on the very first render, with no loading flash', () => {
    put(KEY, 'cached');

    const { result } = renderHook(() =>
      useCachedResource(KEY, MINUTE, () => Promise.resolve('fetched')),
    );

    // Synchronously ready — this is the whole point of the hook.
    expect(result.current.status).toBe('ready');
    expect(result.current.data).toBe('cached');
  });

  it('does not call the loader', async () => {
    put(KEY, 'cached');
    const loader = vi.fn(() => Promise.resolve('fetched'));

    renderHook(() => useCachedResource(KEY, MINUTE, loader));
    await act(async () => {});

    expect(loader).not.toHaveBeenCalled();
  });
});

describe('useCachedResource with a stale cached value', () => {
  it('shows the stale data immediately', () => {
    putStale(KEY, 'stale');

    const { result } = renderHook(() =>
      useCachedResource(KEY, MINUTE, () => Promise.resolve('fresh')),
    );

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toBe('stale');
  });

  it('replaces it once the refresh lands', async () => {
    putStale(KEY, 'stale');
    const loader = vi.fn(() => Promise.resolve('fresh'));

    const { result } = renderHook(() => useCachedResource(KEY, MINUTE, loader));

    await waitFor(() => expect(result.current.data).toBe('fresh'));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('keeps the stale data on screen when the refresh fails, rather than erroring', async () => {
    putStale(KEY, 'stale');
    const loader = vi.fn(() => Promise.reject(new Error('offline')));

    const { result } = renderHook(() => useCachedResource(KEY, MINUTE, loader));

    await waitFor(() => expect(loader).toHaveBeenCalled());
    // A stale headline beats an error message.
    expect(result.current.status).toBe('ready');
    expect(result.current.data).toBe('stale');
  });

  it('still reports why the refresh failed, so `ready` is not read as `current`', async () => {
    // The whole reason this is separate from `status`: a panel serving cached
    // data while every refresh behind it fails looks perfectly healthy, and will
    // go on looking healthy for as long as the cache lasts. Without this there
    // is nothing for it to notice.
    putStale(KEY, 'stale');

    const { result } = renderHook(() =>
      useCachedResource(KEY, MINUTE, () => Promise.reject(new Error('session expired'))),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe('session expired');
    expect(result.current.status).toBe('ready');
    expect(result.current.data).toBe('stale');
  });

  it('clears the error once a load succeeds again', async () => {
    putStale(KEY, 'stale');
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('fresh');

    const { result } = renderHook(() => useCachedResource(KEY, MINUTE, loader));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.data).toBe('fresh'));
    expect(result.current.error).toBeNull();
  });

  it('leaves `revalidating` alone during a background refresh', async () => {
    putStale(KEY, 'stale');
    const pendingLoad = deferred<string>();

    const { result } = renderHook(() => useCachedResource(KEY, MINUTE, () => pendingLoad.promise));

    // The panel should not react to a refresh it did not ask for.
    expect(result.current.revalidating).toBe(false);

    await act(async () => {
      pendingLoad.resolve('fresh');
    });
    expect(result.current.data).toBe('fresh');
  });
});

describe('useCachedResource refresh', () => {
  it('refetches a value that is still fresh', async () => {
    put(KEY, 'cached');
    const loader = vi.fn(() => Promise.resolve('fetched'));
    const { result } = renderHook(() => useCachedResource(KEY, MINUTE, loader));

    await act(async () => result.current.refresh());

    expect(loader).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe('fetched');
  });

  it('reports itself through `revalidating`, keeping the old data meanwhile', () => {
    put(KEY, 'cached');
    const pendingLoad = deferred<string>();
    const { result } = renderHook(() => useCachedResource(KEY, MINUTE, () => pendingLoad.promise));

    act(() => result.current.refresh());

    expect(result.current.revalidating).toBe(true);
    expect(result.current.data).toBe('cached');
  });

  it('clears `revalidating` once the refresh lands', async () => {
    put(KEY, 'cached');
    const pendingLoad = deferred<string>();
    const { result } = renderHook(() => useCachedResource(KEY, MINUTE, () => pendingLoad.promise));
    act(() => result.current.refresh());

    await act(async () => {
      pendingLoad.resolve('fetched');
    });

    expect(result.current.revalidating).toBe(false);
    expect(result.current.data).toBe('fetched');
  });

  it('clears `revalidating` when the refresh fails, keeping the old data', async () => {
    put(KEY, 'cached');
    const pendingLoad = deferred<string>();
    const { result } = renderHook(() => useCachedResource(KEY, MINUTE, () => pendingLoad.promise));

    act(() => result.current.refresh());
    await act(async () => {
      pendingLoad.reject(new Error('offline'));
    });

    expect(result.current).toMatchObject({ revalidating: false, status: 'ready', data: 'cached' });
  });

  it('recovers from error to ready when a retry succeeds', async () => {
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('fresh');
    const { result } = renderHook(() => useCachedResource(KEY, MINUTE, loader));
    await waitFor(() => expect(result.current.status).toBe('error'));

    await act(async () => result.current.refresh());

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toBe('fresh');
  });
});

describe('useCachedResource when the key changes', () => {
  it("adopts the new key's cached value during render, with no intermediate frame", () => {
    put('a', 'value-a');
    put('b', 'value-b');
    const loader = vi.fn(() => Promise.resolve('fetched'));
    const { result, rerender } = renderHook(({ key }) => useCachedResource(key, MINUTE, loader), {
      initialProps: { key: 'a' },
    });
    expect(result.current.data).toBe('value-a');

    rerender({ key: 'b' });

    // Not 'value-a' for one frame, and not a loading placeholder either.
    expect(result.current.status).toBe('ready');
    expect(result.current.data).toBe('value-b');
  });

  it('falls back to loading when the new key has nothing cached', () => {
    put('a', 'value-a');
    const { result, rerender } = renderHook(
      ({ key }) => useCachedResource(key, MINUTE, () => Promise.resolve(`fetched-${key}`)),
      { initialProps: { key: 'a' } },
    );

    rerender({ key: 'b' });

    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('loads the new key', async () => {
    put('a', 'value-a');
    const { result, rerender } = renderHook(
      ({ key }) => useCachedResource(key, MINUTE, () => Promise.resolve(`fetched-${key}`)),
      { initialProps: { key: 'a' } },
    );

    rerender({ key: 'b' });

    await waitFor(() => expect(result.current.data).toBe('fetched-b'));
  });

  it("ignores a late response for a key that is no longer the hook's", async () => {
    const slowLoad = deferred<string>();
    const loaders: Record<string, () => Promise<string>> = {
      a: () => slowLoad.promise,
      b: () => Promise.resolve('value-b'),
    };
    const { result, rerender } = renderHook(
      ({ key }) => useCachedResource(key, MINUTE, () => loaders[key]()),
      { initialProps: { key: 'a' } },
    );

    rerender({ key: 'b' });
    await waitFor(() => expect(result.current.data).toBe('value-b'));

    // 'a' finally answers, long after the widget moved on.
    await act(async () => {
      slowLoad.resolve('value-a');
    });

    expect(result.current.data).toBe('value-b');
  });
});

describe('useCachedResource re-rendering and unmounting', () => {
  it('does not refetch when only the loader identity changes', async () => {
    const loaderCalls = vi.fn();
    const { result, rerender } = renderHook(() =>
      // A fresh closure every render, as a widget with inline props produces.
      useCachedResource(KEY, MINUTE, () => {
        loaderCalls();
        return Promise.resolve('fetched');
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender();
    rerender();
    await act(async () => {});

    expect(loaderCalls).toHaveBeenCalledTimes(1);
  });

  it('sets no state after unmount, but still fills the cache', async () => {
    const pendingLoad = deferred<string>();
    const { unmount } = renderHook(() => useCachedResource(KEY, MINUTE, () => pendingLoad.promise));

    unmount();
    await act(async () => {
      pendingLoad.resolve('fetched');
    });

    // Nothing to assert on the hook itself; the guard's job is to keep React
    // from warning about an update on an unmounted component. The value still
    // reaches the cache, so a remount is served instantly.
    expect(peek<string>(KEY)?.value).toBe('fetched');
  });
});
