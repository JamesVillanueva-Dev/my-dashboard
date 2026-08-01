import { createContext, useCallback, useContext, useState, useEffect } from 'react';

/**
 * The namespace every {@link useLocalStorage} key is written under.
 *
 * Empty string means "unscoped" — the historical, signed-out layout where a key
 * like `todos` is stored as `todos`. When Clerk auth is enabled (ADR 0003) the
 * scope is the signed-in user's id, so the same key becomes `user_2abc:todos`
 * and two accounts sharing a browser never see each other's data.
 */
const StorageScopeContext = createContext<string>('');

/** Wraps a subtree so its persisted state is namespaced (see {@link StorageScopeContext}). */
export const StorageScopeProvider = StorageScopeContext.Provider;

/** Separator between the scope and the key. No unscoped key contains one. */
const SEP = ':';

/** Prefixes `key` with the active scope, if any. */
function scopedKey(scope: string, key: string): string {
  return scope ? `${scope}${SEP}${key}` : key;
}

/** Reads and parses `key`, falling back to `fallback` when absent or unreadable. */
function read<T>(key: string, fallback: T): T {
  try {
    const stored = window.localStorage.getItem(key);
    return stored !== null ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Moves any pre-auth (unscoped) dashboard data into `scope`, once.
 *
 * Without this, switching auth on would appear to wipe the dashboard: the data
 * is still in `localStorage`, but under keys nothing reads any more. The move
 * happens for the *first* account to sign in on this browser and deletes the
 * originals, so a second account starts empty rather than inheriting the first
 * account's notes.
 *
 * Clerk's own `localStorage` entries are left alone, as are keys that are
 * already scoped.
 *
 * @param scope - The namespace to adopt the legacy data into; no-op when empty.
 */
export function adoptLegacyKeys(scope: string): void {
  if (!scope) return;
  try {
    const legacy = Object.keys(window.localStorage).filter(
      (k) => !k.includes(SEP) && !k.startsWith('clerk') && !k.startsWith('__clerk'),
    );
    for (const key of legacy) {
      const value = window.localStorage.getItem(key);
      if (value === null) continue;
      // Don't clobber data this account already has.
      if (window.localStorage.getItem(scopedKey(scope, key)) === null) {
        window.localStorage.setItem(scopedKey(scope, key), value);
      }
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable — nothing to migrate, the app still works in-memory.
  }
}

/**
 * A drop-in replacement for `useState` that transparently persists the value to
 * `window.localStorage`. The initial value is read synchronously on mount so the
 * UI never flashes the default before hydrating from storage.
 *
 * The key is namespaced by the surrounding {@link StorageScopeProvider}, so the
 * same call reads a different slot per signed-in user. If the scope changes, the
 * hook re-reads from the new namespace rather than copying the old value across.
 *
 * All storage access is wrapped in try/catch, so the hook degrades gracefully to
 * plain in-memory state when storage is unavailable (private mode, quota full).
 *
 * @typeParam T - Type of the stored value; must be JSON-serialisable.
 * @param key - localStorage key under which the value is saved, before scoping.
 * @param initialValue - Value used when nothing is stored yet (or on read error).
 * @returns A `[value, setValue]` tuple with the same semantics as `useState`.
 */
export function useLocalStorage<T>(key: string, initialValue: T) {
  const scope = useContext(StorageScopeContext);
  const fullKey = scopedKey(scope, key);

  const [state, setState] = useState<{ key: string; value: T }>(() => ({
    key: fullKey,
    value: read(fullKey, initialValue),
  }));

  // The key changed under us (the user switched accounts). Re-read from the new
  // namespace during render, before the write effect can persist a stale value.
  if (state.key !== fullKey) {
    setState({ key: fullKey, value: read(fullKey, initialValue) });
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(state.key, JSON.stringify(state.value));
    } catch {
      // Storage full or unavailable — ignore, widget still works in-memory.
    }
  }, [state]);

  const setValue = useCallback((action: T | ((prev: T) => T)) => {
    setState((prev) => ({
      key: prev.key,
      value: typeof action === 'function' ? (action as (p: T) => T)(prev.value) : action,
    }));
  }, []);

  return [state.value, setValue] as const;
}
