import { describe, it, expect } from 'vitest';
import { mergeLegacyTodos, sortTasks } from './tasks';
import type { Reminder } from './gcalSync';

const task = (over: Partial<Reminder> & { id: string }): Reminder => ({
  text: 'Task',
  due: '',
  done: false,
  ...over,
});

describe('mergeLegacyTodos', () => {
  it('returns the list untouched when there is nothing to migrate', () => {
    const tasks = [task({ id: 'a' })];
    expect(mergeLegacyTodos(tasks, [])).toBe(tasks);
    expect(mergeLegacyTodos(tasks, undefined)).toBe(tasks);
    expect(mergeLegacyTodos(tasks, null)).toBe(tasks);
  });

  it('survives a corrupt storage value instead of throwing', () => {
    const tasks = [task({ id: 'a' })];
    expect(mergeLegacyTodos(tasks, 'not an array')).toBe(tasks);
    expect(mergeLegacyTodos(tasks, { nope: true })).toBe(tasks);
  });

  it('appends legacy todos as undated tasks', () => {
    const merged = mergeLegacyTodos(
      [task({ id: 'existing' })],
      [
        { id: '1', text: 'Buy milk', done: false },
        { id: '2', text: 'Call mum', done: true },
      ],
    );
    expect(merged).toHaveLength(3);
    expect(merged[1]).toMatchObject({ id: 'todo-1', text: 'Buy milk', due: '', done: false });
    expect(merged[2]).toMatchObject({ id: 'todo-2', text: 'Call mum', due: '', done: true });
  });

  it('never assigns a due date, so migrated todos stay local', () => {
    const merged = mergeLegacyTodos([], [{ id: '1', text: 'x', done: false }]);
    expect(merged[0].due).toBe('');
    expect(merged[0].eventId).toBeUndefined();
  });

  it('is idempotent — running twice does not duplicate', () => {
    const todos = [{ id: '1', text: 'Once', done: false }];
    const once = mergeLegacyTodos([], todos);
    const twice = mergeLegacyTodos(once, todos);
    expect(twice).toHaveLength(1);
  });

  it('skips malformed entries but keeps the good ones', () => {
    const merged = mergeLegacyTodos([], [
      { id: '1', text: 'Good', done: false },
      { text: 'No id' },
      null,
      42,
      { id: '2', text: 'Also good', done: false },
    ]);
    expect(merged.map((t) => t.text)).toEqual(['Good', 'Also good']);
  });

  it('defaults a missing done flag to false', () => {
    const merged = mergeLegacyTodos([], [{ id: '1', text: 'x' } as never]);
    expect(merged[0].done).toBe(false);
  });
});

describe('sortTasks', () => {
  it('puts unfinished tasks before finished ones', () => {
    const sorted = sortTasks([
      task({ id: 'a', text: 'Done', done: true }),
      task({ id: 'b', text: 'Open' }),
    ]);
    expect(sorted.map((t) => t.text)).toEqual(['Open', 'Done']);
  });

  it('orders dated tasks by due date, ahead of undated ones', () => {
    const sorted = sortTasks([
      task({ id: 'a', text: 'No date' }),
      task({ id: 'b', text: 'Later', due: '2026-08-05T10:00' }),
      task({ id: 'c', text: 'Sooner', due: '2026-08-04T10:00' }),
    ]);
    expect(sorted.map((t) => t.text)).toEqual(['Sooner', 'Later', 'No date']);
  });

  it('breaks ties on text so renders are stable', () => {
    const sorted = sortTasks([task({ id: 'a', text: 'B' }), task({ id: 'b', text: 'A' })]);
    expect(sorted.map((t) => t.text)).toEqual(['A', 'B']);
  });
});
