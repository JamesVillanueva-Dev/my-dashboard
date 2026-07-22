import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLocalStorage } from './useLocalStorage';

describe('useLocalStorage', () => {
  it('returns the initial value when nothing is stored', () => {
    const { result } = renderHook(() => useLocalStorage('missing', 'fallback'));
    expect(result.current[0]).toBe('fallback');
  });

  it('reads an existing value from localStorage on mount', () => {
    localStorage.setItem('greeting', JSON.stringify('hi'));
    const { result } = renderHook(() => useLocalStorage('greeting', 'default'));
    expect(result.current[0]).toBe('hi');
  });

  it('persists updates back to localStorage', () => {
    const { result } = renderHook(() => useLocalStorage<number>('count', 0));
    act(() => result.current[1](5));
    expect(result.current[0]).toBe(5);
    expect(localStorage.getItem('count')).toBe('5');
  });

  it('round-trips complex objects', () => {
    const { result } = renderHook(() =>
      useLocalStorage<{ items: string[] }>('obj', { items: [] }),
    );
    act(() => result.current[1]({ items: ['a', 'b'] }));
    expect(result.current[0]).toEqual({ items: ['a', 'b'] });
    expect(JSON.parse(localStorage.getItem('obj')!)).toEqual({ items: ['a', 'b'] });
  });

  it('falls back gracefully when stored JSON is corrupt', () => {
    localStorage.setItem('broken', '{not valid json');
    const { result } = renderHook(() => useLocalStorage('broken', 'safe'));
    expect(result.current[0]).toBe('safe');
  });
});
