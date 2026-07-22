import { useState, useEffect } from 'react';

/**
 * A drop-in replacement for `useState` that transparently persists the value to
 * `window.localStorage`. The initial value is read synchronously on mount so the
 * UI never flashes the default before hydrating from storage.
 *
 * All storage access is wrapped in try/catch, so the hook degrades gracefully to
 * plain in-memory state when storage is unavailable (private mode, quota full).
 *
 * @typeParam T - Type of the stored value; must be JSON-serialisable.
 * @param key - localStorage key under which the value is saved.
 * @param initialValue - Value used when nothing is stored yet (or on read error).
 * @returns A `[value, setValue]` tuple with the same semantics as `useState`.
 */
export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored !== null ? (JSON.parse(stored) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or unavailable — ignore, widget still works in-memory.
    }
  }, [key, value]);

  return [value, setValue] as const;
}
