import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCachedResource } from './useCachedResource';
import { peek, put } from '../lib/cache';

const MINUTE = 60_000;

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
function makeStale(key: string, value: unknown, ttlMs = MINUTE) {
  put(key, value);
  const entry = peek(key)!;
  entry.at = Date.now() - ttlMs - 1;
}

describe('useCachedResource', () => {
  it('starts in loading with nothing cached, then settles on the loaded value', async () => {
    const { result } = renderHook(() => useCachedResource('k', MINUTE, () => Promise.resolve(1)));

    expect(result.current).toMatchObject({ status: 'loading', data: null });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toBe(1);
  });

  it('paints cached data on the very first render, with no loading flash', () => {
    put('k', 'cached');

    const { result } = renderHook(() =>
      useCachedResource('k', MINUTE, () => Promise.resolve('fetched')),
    );

    // Synchronously ready — this is the whole point of the hook.
    expect(result.current).toMatchObject({ status: 'ready', data: 'cached' });
  });

  it('does not call the loader while the cached value is fresh', async () => {
    put('k', 'cached');
    const loader = vi.fn(() => Promise.resolve('fetched'));

    renderHook(() => useCachedResource('k', MINUTE, loader));
    await act(async () => {});

    expect(loader).not.toHaveBeenCalled();
  });

  it('shows stale data immediately and replaces it once the refresh lands', async () => {
    makeStale('k', 'stale');
    const loader = vi.fn(() => Promise.resolve('fresh'));

    const { result } = renderHook(() => useCachedResource('k', MINUTE, loader));

    expect(result.current).toMatchObject({ status: 'ready', data: 'stale' });
    await waitFor(() => expect(result.current.data).toBe('fresh'));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('reports error only when there is nothing to show', async () => {
    const { result } = renderHook(() =>
      useCachedResource('k', MINUTE, () => Promise.reject(new Error('offline'))),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.data).toBeNull();
  });

  it('keeps stale data on screen when a refresh fails, rather than erroring', async () => {
    makeStale('k', 'stale');
    const loader = vi.fn(() => Promise.reject(new Error('offline')));

    const { result } = renderHook(() => useCachedResource('k', MINUTE, loader));

    await waitFor(() => expect(loader).toHaveBeenCalled());
    // A stale headline beats an error message.
    expect(result.current).toMatchObject({ status: 'ready', data: 'stale' });
  });

  it('recovers from error to ready when a retry succeeds', async () => {
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('fresh');

    const { result } = renderHook(() => useCachedResource('k', MINUTE, loader));
    await waitFor(() => expect(result.current.status).toBe('error'));

    await act(async () => result.current.refresh());

    expect(result.current).toMatchObject({ status: 'ready', data: 'fresh' });
  });

  describe('refresh', () => {
    it('refetches a value that is still fresh', async () => {
      put('k', 'cached');
      const loader = vi.fn(() => Promise.resolve('fetched'));
      const { result } = renderHook(() => useCachedResource('k', MINUTE, loader));

      await act(async () => result.current.refresh());

      expect(loader).toHaveBeenCalledTimes(1);
      expect(result.current.data).toBe('fetched');
    });

    it('announces itself through `revalidating`, and keeps the old data meanwhile', async () => {
      put('k', 'cached');
      const gate = deferred<string>();
      const { result } = renderHook(() => useCachedResource('k', MINUTE, () => gate.promise));

      act(() => result.current.refresh());

      expect(result.current.revalidating).toBe(true);
      expect(result.current.data).toBe('cached');

      await act(async () => {
        gate.resolve('fetched');
      });

      expect(result.current).toMatchObject({ revalidating: false, data: 'fetched' });
    });

    it('clears `revalidating` when the refresh fails', async () => {
      put('k', 'cached');
      const gate = deferred<string>();
      const { result } = renderHook(() => useCachedResource('k', MINUTE, () => gate.promise));

      act(() => result.current.refresh());
      await act(async () => {
        gate.reject(new Error('offline'));
      });

      expect(result.current).toMatchObject({ revalidating: false, status: 'ready', data: 'cached' });
    });

    it('leaves `revalidating` alone during a background refresh', async () => {
      makeStale('k', 'stale');
      const gate = deferred<string>();

      const { result } = renderHook(() => useCachedResource('k', MINUTE, () => gate.promise));

      // The panel should not react to a refresh it did not ask for.
      expect(result.current.revalidating).toBe(false);

      await act(async () => {
        gate.resolve('fresh');
      });
      expect(result.current.data).toBe('fresh');
    });
  });

  describe('changing key', () => {
    it("adopts the new key's cached value during render, with no intermediate frame", async () => {
      put('a', 'value-a');
      put('b', 'value-b');
      const loader = vi.fn(() => Promise.resolve('fetched'));

      const { result, rerender } = renderHook(({ key }) => useCachedResource(key, MINUTE, loader), {
        initialProps: { key: 'a' },
      });
      expect(result.current.data).toBe('value-a');

      rerender({ key: 'b' });

      // Not 'value-a' for one frame, and not a loading placeholder either.
      expect(result.current).toMatchObject({ status: 'ready', data: 'value-b' });
    });

    it('falls back to loading when the new key has nothing cached', async () => {
      put('a', 'value-a');
      const { result, rerender } = renderHook(
        ({ key }) => useCachedResource(key, MINUTE, () => Promise.resolve(`fetched-${key}`)),
        { initialProps: { key: 'a' } },
      );

      rerender({ key: 'b' });
      expect(result.current).toMatchObject({ status: 'loading', data: null });

      await waitFor(() => expect(result.current.data).toBe('fetched-b'));
    });

    it("ignores a late response for a key that is no longer the hook's", async () => {
      const slow = deferred<string>();
      const loaders: Record<string, () => Promise<string>> = {
        a: () => slow.promise,
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
        slow.resolve('value-a');
      });

      expect(result.current.data).toBe('value-b');
    });
  });

  it('does not refetch when only the loader identity changes', async () => {
    const calls = vi.fn();
    const { result, rerender } = renderHook(() =>
      // A fresh closure every render, as a widget with inline props produces.
      useCachedResource('k', MINUTE, () => {
        calls();
        return Promise.resolve('fetched');
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender();
    rerender();
    await act(async () => {});

    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('sets no state after unmount', async () => {
    const gate = deferred<string>();
    const { unmount } = renderHook(() => useCachedResource('k', MINUTE, () => gate.promise));

    unmount();
    await act(async () => {
      gate.resolve('fetched');
    });

    // Nothing to assert on the hook itself; the guard's job is to keep React
    // from warning about an update on an unmounted component. The value still
    // reaches the cache, so a remount is served instantly.
    expect(peek<string>('k')?.value).toBe('fetched');
  });
});
