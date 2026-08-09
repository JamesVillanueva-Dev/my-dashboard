import { useCallback, useEffect, useRef, useState } from 'react';
import { isFresh, load, peek } from '../lib/cache';

/** What {@link useCachedResource} hands back to a widget. */
export interface CachedResource<T> {
  /** The cached or freshly loaded value; `null` only before the first success. */
  data: T | null;
  /**
   * `loading` means there is genuinely nothing to show yet. A refresh behind
   * cached data is *not* loading — see {@link CachedResource.revalidating} —
   * which is what stops a panel blanking out every time it re-mounts.
   */
  status: 'loading' | 'ready' | 'error';
  /**
   * Why the last load failed, or `null` when it did not.
   *
   * Set independently of {@link CachedResource.status}, and that is the point:
   * a refresh that fails behind cached data leaves the status `ready`, because
   * stale data still beats an error message. But "stale" and "current" are not
   * the same claim, and a panel that cannot tell them apart will present a
   * fortnight-old answer as today's. This is how it tells.
   */
  error: Error | null;
  /**
   * A refresh asked for by the user is in flight. Background revalidation does
   * not set this — it is not something the panel should react to.
   */
  revalidating: boolean;
  /** Refetch now, ignoring the TTL. Keeps the current data visible meanwhile. */
  refresh: () => void;
}

/**
 * The hook's internal state, held as one object so a key change can swap every
 * field atomically. Splitting these into separate `useState` calls would let a
 * render see the new key beside the previous key's data.
 */
interface State<T> {
  /** The key this state describes, so a stale response can be discarded. */
  key: string;
  /** Latest value for `key`, or `null` before the first success. */
  data: T | null;
  /** As {@link CachedResource.status}. */
  status: CachedResource<T>['status'];
  /** As {@link CachedResource.error}. */
  error: Error | null;
  /** As {@link CachedResource.revalidating}. */
  revalidating: boolean;
}

/** The state a key starts from: whatever is already cached, or empty. */
function fromCache<T>(key: string): State<T> {
  const hit = peek<T>(key);
  return {
    key,
    data: hit ? hit.value : null,
    status: hit ? 'ready' : 'loading',
    error: null,
    revalidating: false,
  };
}

/** Whether `key` holds a value new enough that there is nothing worth fetching. */
function isCurrent(key: string, ttlMs: number): boolean {
  const hit = peek(key);
  return hit !== undefined && isFresh(hit, ttlMs);
}

/**
 * Reads a cached, refreshable resource.
 *
 * The value is served from the cache (see `lib/cache.ts`) and refreshed in the
 * background when it is older than `ttlMs`. Changing `key` adopts that key's
 * cached value *during render*, so switching a news feed back to one you already
 * read paints instantly instead of flashing a placeholder.
 *
 * A failed refresh does not clear what is on screen: if there is cached data the
 * status stays `ready` and the stale copy remains, since a stale headline beats
 * an error message. `error` is only for the case where there is nothing to show.
 *
 * @typeParam T - The resource's value type; must be JSON-serialisable, as it is
 *   persisted between sessions.
 * @param key - Cache key. Must encode every input the value depends on.
 * @param ttlMs - How long a value stays fresh before a background refresh.
 * @param loader - Fetches the value. Re-created every render is fine — it is
 *   read through a ref, so it never re-triggers a fetch on its own; `key` alone
 *   decides when to reload.
 */
export function useCachedResource<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): CachedResource<T> {
  const loaderRef = useRef(loader);
  // Late responses must not overwrite a newer key's state, and nothing should be
  // set after unmount.
  const keyRef = useRef(key);
  const aliveRef = useRef(true);

  // Keep the mutable copies in step with what this render saw. This effect has
  // no dependency array (it runs after every render) and is declared before the
  // one that fetches, so `run` always reads current values.
  useEffect(() => {
    loaderRef.current = loader;
    keyRef.current = key;
  });

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const [state, setState] = useState<State<T>>(() => fromCache<T>(key));

  // The key changed under us. Adopt the new key's cached value now, during
  // render, rather than after an effect — otherwise this paints one frame of the
  // previous key's data, which is worse than the loading state it replaced.
  if (state.key !== key) setState(fromCache<T>(key));

  /**
   * Fetches and adopts the result. Deliberately sets no state before its first
   * `await`: the mount path runs this from an effect, and a synchronous update
   * there would cascade an extra render on every panel, every time.
   */
  const revalidate = useCallback(
    async (force: boolean) => {
      try {
        const value = await load(key, ttlMs, () => loaderRef.current(), force);
        if (!aliveRef.current || keyRef.current !== key) return;
        setState({ key, data: value, status: 'ready', error: null, revalidating: false });
      } catch (e) {
        if (!aliveRef.current || keyRef.current !== key) return;
        const error = e instanceof Error ? e : new Error(String(e));
        setState((prev) => ({
          key,
          data: prev.data,
          status: prev.data != null ? 'ready' : 'error',
          error,
          revalidating: false,
        }));
      }
    },
    [key, ttlMs],
  );

  // Load on mount and whenever the key changes — unless what render already
  // painted from the cache is current, in which case there is nothing to do.
  useEffect(() => {
    if (isCurrent(key, ttlMs)) return;
    void revalidate(false);
  }, [key, ttlMs, revalidate]);

  // Only the deliberate path announces itself. A background revalidation stays
  // invisible: the data on screen is still the truth until the new data lands.
  const refresh = useCallback(() => {
    setState((prev) => ({ ...prev, revalidating: true }));
    void revalidate(true);
  }, [revalidate]);

  return {
    data: state.data,
    status: state.status,
    error: state.error,
    revalidating: state.revalidating,
    refresh,
  };
}
