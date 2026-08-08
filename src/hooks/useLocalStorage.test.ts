import { describe, it, expect } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { StorageScopeProvider, adoptLegacyKeys, useLocalStorage } from './useLocalStorage';

/** Renders a hook inside a storage scope, as `<AuthGate>` does when signed in. */
function withStorageScope(scope: string) {
  return ({ children }: { children: ReactNode }) =>
    createElement(StorageScopeProvider, { value: scope }, children);
}

describe('useLocalStorage', () => {
  it('returns the initial value when nothing is stored', () => {
    const { result } = renderHook(() => useLocalStorage('missing', 'fallback'));

    const [value] = result.current;
    expect(value).toBe('fallback');
  });

  it('reads an existing value from localStorage on mount', () => {
    localStorage.setItem('greeting', JSON.stringify('hi'));

    const { result } = renderHook(() => useLocalStorage('greeting', 'default'));

    const [value] = result.current;
    expect(value).toBe('hi');
  });

  it('falls back to the initial value when the stored JSON is corrupt', () => {
    localStorage.setItem('broken', '{not valid json');

    const { result } = renderHook(() => useLocalStorage('broken', 'safe'));

    const [value] = result.current;
    expect(value).toBe('safe');
  });

  it('persists an update back to localStorage', () => {
    const { result } = renderHook(() => useLocalStorage<number>('count', 0));
    const [, setCount] = result.current;

    act(() => setCount(5));

    const [count] = result.current;
    expect(count).toBe(5);
    expect(localStorage.getItem('count')).toBe('5');
  });

  it('round-trips a complex object', () => {
    const { result } = renderHook(() => useLocalStorage<{ items: string[] }>('obj', { items: [] }));
    const [, setObject] = result.current;

    act(() => setObject({ items: ['a', 'b'] }));

    const [stored] = result.current;
    expect(stored).toEqual({ items: ['a', 'b'] });
    expect(JSON.parse(localStorage.getItem('obj')!)).toEqual({ items: ['a', 'b'] });
  });

  it('supports a functional update', () => {
    const { result } = renderHook(() => useLocalStorage<number>('count', 1));
    const [, setCount] = result.current;

    act(() => setCount((previous) => previous + 1));

    const [count] = result.current;
    expect(count).toBe(2);
  });
});

describe('useLocalStorage per-user scoping', () => {
  it('writes under a namespaced key when a scope is provided', () => {
    const { result } = renderHook(() => useLocalStorage<string>('notes.text', ''), {
      wrapper: withStorageScope('user_a'),
    });
    const [, setNotes] = result.current;

    act(() => setNotes('scoped note'));

    expect(localStorage.getItem('user_a:notes.text')).toBe(JSON.stringify('scoped note'));
    expect(localStorage.getItem('notes.text')).toBeNull();
  });

  it('keeps two users on the same browser isolated', () => {
    localStorage.setItem('user_a:todos', JSON.stringify(['a task']));
    localStorage.setItem('user_b:todos', JSON.stringify(['b task']));

    const userA = renderHook(() => useLocalStorage<string[]>('todos', []), {
      wrapper: withStorageScope('user_a'),
    });
    const userB = renderHook(() => useLocalStorage<string[]>('todos', []), {
      wrapper: withStorageScope('user_b'),
    });

    expect(userA.result.current[0]).toEqual(['a task']);
    expect(userB.result.current[0]).toEqual(['b task']);
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
    const todosInScope = (scope: string) =>
      createElement(StorageScopeProvider, { value: scope }, createElement(Todos));

    const { rerender } = render(todosInScope('user_a'));
    expect(screen.getByTestId('todos')).toHaveTextContent('a task');

    rerender(todosInScope('user_b'));

    expect(screen.getByTestId('todos')).toHaveTextContent('b task');
    // The switch must not drag the previous account's data across.
    expect(JSON.parse(localStorage.getItem('user_b:todos')!)).toEqual(['b task']);
  });
});

describe('adoptLegacyKeys', () => {
  it('moves pre-auth data into the first signed-in user’s namespace', () => {
    localStorage.setItem('todos', JSON.stringify(['old task']));
    localStorage.setItem('theme', JSON.stringify('dark'));

    adoptLegacyKeys('user_a');

    expect(JSON.parse(localStorage.getItem('user_a:todos')!)).toEqual(['old task']);
    expect(JSON.parse(localStorage.getItem('user_a:theme')!)).toBe('dark');
  });

  it('removes the unscoped originals it moved', () => {
    localStorage.setItem('todos', JSON.stringify(['old task']));

    adoptLegacyKeys('user_a');

    expect(localStorage.getItem('todos')).toBeNull();
  });

  it('leaves a second user empty, because the originals are consumed', () => {
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
