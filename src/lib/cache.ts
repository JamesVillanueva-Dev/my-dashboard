/**
 * A tiny stale-while-revalidate cache for the widgets' network reads.
 *
 * Every network-backed widget used to fetch on mount and show a "Loading…"
 * placeholder while it did. That is fine once, but a widget re-mounts far more
 * often than you would think — toggling it off and on, switching a tab back to a
 * feed you were just reading, or simply reloading the page — and each time the
 * panel emptied itself and started over.
 *
 * So results are cached in two layers:
 *
 * - **Memory**, keyed by request. Survives a component unmounting and remounting
 *   within the session, so a panel that comes back is populated on its first
 *   render, with no loading flash at all.
 * - **`localStorage`**, so a reload (or a redeploy) starts from the last known
 *   data rather than a blank panel, then quietly refreshes behind it.
 *
 * Entries carry the time they were stored. Past the caller's TTL a value is
 * *stale*, not gone: the caller still renders it immediately while a refresh
 * runs. Nothing here ever leaves a panel blank when it has something to show.
 *
 * Concurrent reads of the same key share one request — two widgets asking for
 * the same feed at once make one fetch, not two.
 *
 * This is deliberately not a data-fetching library. It caches promises by key;
 * React binding lives in `useCachedResource`.
 */

/** A stored result and when it was stored. */
export interface CacheEntry<T> {
  /** The cached payload, exactly as the fetcher returned it. */
  value: T;
  /** Epoch ms at which `value` was written. */
  at: number;
}

/**
 * Bumped when the stored shape changes. Entries written by an older version are
 * ignored rather than parsed, so a deploy that changes what a widget stores
 * cannot hand it data it no longer understands.
 */
const VERSION = 2;

/**
 * Prefix for the `localStorage` slots.
 *
 * The colon matters: `adoptLegacyKeys` treats any key containing one as already
 * scoped to a user and leaves it alone, which is what we want. Cached public
 * weather and headlines are not per-account data and should not be migrated
 * into an account's namespace on sign-in.
 */
const PREFIX = 'cache:';

/**
 * The in-memory tier, read before `localStorage`. It survives a remount but not
 * a reload, and spares every widget a JSON parse on each render pass.
 */
const memory = new Map<string, CacheEntry<unknown>>();

/**
 * Requests currently in flight, keyed the same way. This is what makes two
 * widgets asking for one feed at the same moment cost a single fetch: the second
 * caller is handed the first caller's promise.
 */
const inflight = new Map<string, Promise<unknown>>();

/** Reads an entry from `localStorage`, ignoring anything unreadable or stale-shaped. */
function readStored<T>(key: string): CacheEntry<T> | undefined {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as { v?: number; at?: number; value?: T };
    if (parsed.v !== VERSION || typeof parsed.at !== 'number') return undefined;
    return { value: parsed.value as T, at: parsed.at };
  } catch {
    return undefined;
  }
}

/**
 * Returns the cached entry for `key`, or `undefined` when nothing is cached.
 *
 * Checks memory first, then `localStorage` — a hit there is promoted into memory
 * so the next read costs nothing.
 */
export function peek<T>(key: string): CacheEntry<T> | undefined {
  const hit = memory.get(key) as CacheEntry<T> | undefined;
  if (hit) return hit;
  const stored = readStored<T>(key);
  if (stored) memory.set(key, stored);
  return stored;
}

/** Whether an entry is younger than `ttlMs`. */
export function isFresh(entry: CacheEntry<unknown>, ttlMs: number): boolean {
  return Date.now() - entry.at < ttlMs;
}

/** Stores `value` under `key`, in memory and (best effort) in `localStorage`. */
export function put<T>(key: string, value: T): CacheEntry<T> {
  const entry = { value, at: Date.now() };
  memory.set(key, entry);
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify({ v: VERSION, ...entry }));
  } catch {
    // Quota full, or storage unavailable. The memory layer still works; the only
    // cost is that a reload starts cold.
  }
  return entry;
}

/**
 * Resolves the value for `key`, fetching only when it has to.
 *
 * @param key - Identifies the request. Include every input the result depends on
 *   (city and unit, feed URL, …) so changing one is a different cache slot
 *   rather than a stale hit.
 * @param ttlMs - How long a stored value counts as fresh. A fresh value resolves
 *   without touching `loader`.
 * @param loader - Performs the actual fetch. Called at most once per key at a
 *   time — concurrent callers share the in-flight promise.
 * @param force - Skip the freshness check and refetch (the widgets' refresh and
 *   retry buttons). Still shares an in-flight request.
 * @returns The cached or freshly loaded value. Rejects if `loader` rejects; the
 *   previously cached entry, if any, is left in place for the caller to fall
 *   back on.
 */
export function load<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  force = false,
): Promise<T> {
  if (!force) {
    const hit = peek<T>(key);
    if (hit && isFresh(hit, ttlMs)) return Promise.resolve(hit.value);
  }

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const request = loader()
    .then((value) => {
      put(key, value);
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}

/**
 * Drops everything: memory, in-flight requests, and the `localStorage` slots.
 *
 * Tests call this between cases — the memory layer is module state and would
 * otherwise leak a previous test's response into the next one.
 */
export function clearCache(): void {
  memory.clear();
  inflight.clear();
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable — the memory layer is cleared either way.
  }
}
