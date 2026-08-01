import { describe, it, expect } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { StorageScopeProvider, adoptLegacyKeys, useLocalStorage } from './useLocalStorage';

/** Renders a hook inside a storage scope, as `<AuthGate>` does when signed in. */
function scoped(scope: string) {
  return ({ children }: { children: ReactNode }) =>
    createElement(StorageScopeProvider, { value: scope }, children);
}

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

  it('supports functional updates', () => {
    const { result } = renderHook(() => useLocalStorage<number>('count', 1));
    act(() => result.current[1]((prev) => prev + 1));
    expect(result.current[0]).toBe(2);
  });

  it('falls back gracefully when stored JSON is corrupt', () => {
    localStorage.setItem('broken', '{not valid json');
    const { result } = renderHook(() => useLocalStorage('broken', 'safe'));
    expect(result.current[0]).toBe('safe');
  });

  describe('per-user scoping', () => {
    it('writes under a namespaced key when a scope is provided', () => {
      const { result } = renderHook(() => useLocalStorage<string>('notes.text', ''), {
        wrapper: scoped('user_a'),
      });
      act(() => result.current[1]('scoped note'));

      expect(localStorage.getItem('user_a:notes.text')).toBe(JSON.stringify('scoped note'));
      expect(localStorage.getItem('notes.text')).toBeNull();
    });

    it('keeps two users on the same browser isolated', () => {
      localStorage.setItem('user_a:todos', JSON.stringify(['a task']));
      localStorage.setItem('user_b:todos', JSON.stringify(['b task']));

      const a = renderHook(() => useLocalStorage<string[]>('todos', []), {
        wrapper: scoped('user_a'),
      });
      const b = renderHook(() => useLocalStorage<string[]>('todos', []), {
        wrapper: scoped('user_b'),
      });

      expect(a.result.current[0]).toEqual(['a task']);
      expect(b.result.current[0]).toEqual(['b task']);
    });

    it('re-reads from the new namespace when the scope changes', () => {
      localStorage.setItem('user_a:todos', JSON.stringify(['a task']));
      localStorage.setItem('user_b:todos', JSON.stringify(['b task']));

      // A probe whose scope can change between renders, as it does when one
      // account signs out and another signs in without a full reload.
      function Todos() {
        const [todos] = useLocalStorage<string[]>('todos', []);
        return createElement('span', { 'data-testid': 'todos' }, todos.join(','));
      }
      const probe = (scope: string) =>
        createElement(StorageScopeProvider, { value: scope }, createElement(Todos));

      const { rerender } = render(probe('user_a'));
      expect(screen.getByTestId('todos')).toHaveTextContent('a task');

      rerender(probe('user_b'));
      expect(screen.getByTestId('todos')).toHaveTextContent('b task');
      // The switch must not drag the previous account's data across.
      expect(JSON.parse(localStorage.getItem('user_b:todos')!)).toEqual(['b task']);
    });
  });
});

describe('adoptLegacyKeys', () => {
  it('moves pre-auth data into the first signed-in user namespace', () => {
    localStorage.setItem('todos', JSON.stringify(['old task']));
    localStorage.setItem('theme', JSON.stringify('dark'));

    adoptLegacyKeys('user_a');

    expect(JSON.parse(localStorage.getItem('user_a:todos')!)).toEqual(['old task']);
    expect(JSON.parse(localStorage.getItem('user_a:theme')!)).toBe('dark');
    expect(localStorage.getItem('todos')).toBeNull();
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('leaves a second user empty because the originals are consumed', () => {
    localStorage.setItem('notes.text', JSON.stringify('private note'));

    adoptLegacyKeys('user_a');
    adoptLegacyKeys('user_b');

    expect(localStorage.getItem('user_b:notes.text')).toBeNull();
  });

  it('never clobbers data the account already has', () => {
    localStorage.setItem('notes.text', JSON.stringify('legacy'));
    localStorage.setItem('user_a:notes.text', JSON.stringify('mine'));

    adoptLegacyKeys('user_a');

    expect(JSON.parse(localStorage.getItem('user_a:notes.text')!)).toBe('mine');
  });

  it("ignores Clerk's own storage entries", () => {
    localStorage.setItem('__clerk_db_jwt', 'jwt-value');
    localStorage.setItem('clerk-session', 'session-value');

    adoptLegacyKeys('user_a');

    expect(localStorage.getItem('__clerk_db_jwt')).toBe('jwt-value');
    expect(localStorage.getItem('clerk-session')).toBe('session-value');
  });

  it('does nothing without a scope', () => {
    localStorage.setItem('todos', JSON.stringify(['keep']));
    adoptLegacyKeys('');
    expect(JSON.parse(localStorage.getItem('todos')!)).toEqual(['keep']);
  });
});
