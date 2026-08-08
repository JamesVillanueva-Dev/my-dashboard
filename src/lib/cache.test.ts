import { describe, it, expect, vi } from 'vitest';
import { clearCache, isFresh, load, peek, put } from './cache';

const MINUTE = 60_000;

/** The key under test, and the localStorage slot it persists to. */
const KEY = 'weather';
const STORAGE_KEY = 'cache:weather';

describe('put and peek', () => {
  it('returns undefined for a key that was never stored', () => {
    expect(peek('never-stored')).toBeUndefined();
  });

  it('reads back a stored value', () => {
    put(KEY, { hello: 'world' });

    expect(peek<{ hello: string }>(KEY)?.value).toEqual({ hello: 'world' });
  });

  it('reads a value back from localStorage after the memory layer is lost', () => {
    put(KEY, 'stored');

    // Simulate a reload: the memory layer is gone, localStorage is not.
    const persisted = window.localStorage.getItem(STORAGE_KEY)!;
    clearCache();
    window.localStorage.setItem(STORAGE_KEY, persisted);

    expect(peek<string>(KEY)?.value).toBe('stored');
  });

  it('ignores an entry written by an older cache version', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 0, at: Date.now(), value: 'old' }));

    expect(peek(KEY)).toBeUndefined();
  });

  it('ignores stored data that is not valid JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');

    expect(peek(KEY)).toBeUndefined();
  });
});

describe('isFresh', () => {
  it('is true for an entry younger than the max age', () => {
    const entry = put(KEY, 1);

    expect(isFresh(entry, MINUTE)).toBe(true);
  });

  it('is false once the entry is older than the max age', () => {
    const entry = put(KEY, 1);

    vi.spyOn(Date, 'now').mockReturnValue(entry.at + MINUTE + 1);

    expect(isFresh(entry, MINUTE)).toBe(false);
  });
});

describe('load', () => {
  it('serves a fresh value without calling the loader', async () => {
    put(KEY, 'cached');
    const loader = vi.fn(() => Promise.resolve('fetched'));

    await expect(load(KEY, MINUTE, loader)).resolves.toBe('cached');
    expect(loader).not.toHaveBeenCalled();
  });

  it('calls the loader once the value is stale', async () => {
    const entry = put(KEY, 'cached');
    vi.spyOn(Date, 'now').mockReturnValue(entry.at + MINUTE + 1);
    const loader = vi.fn(() => Promise.resolve('fetched'));

    await expect(load(KEY, MINUTE, loader)).resolves.toBe('fetched');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('refetches a still-fresh value when forced, and stores the result', async () => {
    put(KEY, 'cached');
    const loader = vi.fn(() => Promise.resolve('fetched'));

    await expect(load(KEY, MINUTE, loader, true)).resolves.toBe('fetched');
    expect(peek<string>(KEY)?.value).toBe('fetched');
  });

  it('shares one request between concurrent callers', async () => {
    const loader = vi.fn(() => Promise.resolve('once'));

    const results = await Promise.all([load(KEY, MINUTE, loader), load(KEY, MINUTE, loader)]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(results).toEqual(['once', 'once']);
  });

  it('keeps the stale value to fall back on when a refresh fails', async () => {
    const entry = put(KEY, 'cached');
    vi.spyOn(Date, 'now').mockReturnValue(entry.at + MINUTE + 1);

    const failedRefresh = load(KEY, MINUTE, () => Promise.reject(new Error('offline')));

    await expect(failedRefresh).rejects.toThrow('offline');
    expect(peek<string>(KEY)?.value).toBe('cached');
  });

  it('allows a retry after a failed refresh', async () => {
    const entry = put(KEY, 'cached');
    vi.spyOn(Date, 'now').mockReturnValue(entry.at + MINUTE + 1);
    await expect(
      load(KEY, MINUTE, () => Promise.reject(new Error('offline'))),
    ).rejects.toThrow();

    // The failure did not leave the key stuck as "in flight".
    await expect(load(KEY, MINUTE, () => Promise.resolve('fresh'))).resolves.toBe('fresh');
  });

  it('does not cache a rejected load', async () => {
    await expect(load(KEY, MINUTE, () => Promise.reject(new Error('nope')))).rejects.toThrow();

    expect(peek(KEY)).toBeUndefined();
  });
});

describe('clearCache', () => {
  it('drops cached values and their persisted copies, leaving other keys alone', () => {
    put(KEY, 'cached');
    window.localStorage.setItem('layout', '["notes"]');

    clearCache();

    expect(peek(KEY)).toBeUndefined();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem('layout')).toBe('["notes"]');
  });
});
