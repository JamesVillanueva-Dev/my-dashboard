import { describe, it, expect, vi } from 'vitest';
import { clearCache, isFresh, load, peek, put } from './cache';

const MINUTE = 60_000;

describe('cache', () => {
  it('returns nothing for a key that was never stored', () => {
    expect(peek('nope')).toBeUndefined();
  });

  it('stores and reads a value back', () => {
    put('k', { hello: 'world' });
    expect(peek<{ hello: string }>('k')?.value).toEqual({ hello: 'world' });
  });

  it('survives the memory layer being lost, reading from localStorage', () => {
    put('k', 'stored');
    // Simulate a reload: the memory layer is gone, localStorage is not.
    const persisted = window.localStorage.getItem('cache:k')!;
    clearCache();
    window.localStorage.setItem('cache:k', persisted);

    expect(peek<string>('k')?.value).toBe('stored');
  });

  it('ignores an entry written by an older cache version', () => {
    window.localStorage.setItem('cache:k', JSON.stringify({ v: 0, at: Date.now(), value: 'old' }));
    expect(peek('k')).toBeUndefined();
  });

  it('ignores unparseable stored data instead of throwing', () => {
    window.localStorage.setItem('cache:k', '{not json');
    expect(peek('k')).toBeUndefined();
  });

  it('ages an entry out of freshness', () => {
    const entry = put('k', 1);
    expect(isFresh(entry, MINUTE)).toBe(true);

    vi.spyOn(Date, 'now').mockReturnValue(entry.at + MINUTE + 1);
    expect(isFresh(entry, MINUTE)).toBe(false);
  });

  it('serves a fresh value without calling the loader', async () => {
    put('k', 'cached');
    const loader = vi.fn(() => Promise.resolve('fetched'));

    await expect(load('k', MINUTE, loader)).resolves.toBe('cached');
    expect(loader).not.toHaveBeenCalled();
  });

  it('refetches once the value is stale', async () => {
    const entry = put('k', 'cached');
    vi.spyOn(Date, 'now').mockReturnValue(entry.at + MINUTE + 1);
    const loader = vi.fn(() => Promise.resolve('fetched'));

    await expect(load('k', MINUTE, loader)).resolves.toBe('fetched');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('refetches a fresh value when forced', async () => {
    put('k', 'cached');
    const loader = vi.fn(() => Promise.resolve('fetched'));

    await expect(load('k', MINUTE, loader, true)).resolves.toBe('fetched');
    expect(peek<string>('k')?.value).toBe('fetched');
  });

  it('shares one request between concurrent callers', async () => {
    const loader = vi.fn(() => Promise.resolve('once'));

    const [a, b] = await Promise.all([load('k', MINUTE, loader), load('k', MINUTE, loader)]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect([a, b]).toEqual(['once', 'once']);
  });

  it('keeps the previous value when a refresh fails, and allows a retry', async () => {
    const entry = put('k', 'cached');
    vi.spyOn(Date, 'now').mockReturnValue(entry.at + MINUTE + 1);

    await expect(load('k', MINUTE, () => Promise.reject(new Error('offline')))).rejects.toThrow(
      'offline',
    );
    // The stale copy is still there to fall back on...
    expect(peek<string>('k')?.value).toBe('cached');
    // ...and the failure did not leave the key stuck as "in flight".
    await expect(load('k', MINUTE, () => Promise.resolve('fresh'))).resolves.toBe('fresh');
  });

  it('does not cache a rejected load', async () => {
    await expect(load('k', MINUTE, () => Promise.reject(new Error('nope')))).rejects.toThrow();
    expect(peek('k')).toBeUndefined();
  });

  it('clears memory and the persisted slots, leaving other keys alone', () => {
    put('k', 'cached');
    window.localStorage.setItem('layout', '["notes"]');

    clearCache();

    expect(peek('k')).toBeUndefined();
    expect(window.localStorage.getItem('cache:k')).toBeNull();
    expect(window.localStorage.getItem('layout')).toBe('["notes"]');
  });
});
