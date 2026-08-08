import { describe, it, expect } from 'vitest';
import { mergeLegacyTodos, sortTasks } from './tasks';
import type { Reminder } from './gcalSync';

/** Builds a task, with only the fields a case cares about spelled out. */
const task = (overrides: Partial<Reminder> & { id: string }): Reminder => ({
  text: 'Task',
  due: '',
  done: false,
  ...overrides,
});

/** The task texts, in order — what most of these cases actually assert on. */
const textsOf = (tasks: Reminder[]) => tasks.map((each) => each.text);

describe('mergeLegacyTodos', () => {
  it('returns the same list when there is nothing to migrate', () => {
    const tasks = [task({ id: 'a' })];

    expect(mergeLegacyTodos(tasks, [])).toBe(tasks);
    expect(mergeLegacyTodos(tasks, undefined)).toBe(tasks);
    expect(mergeLegacyTodos(tasks, null)).toBe(tasks);
  });

  it('returns the same list when the stored value is not an array', () => {
    const tasks = [task({ id: 'a' })];

    expect(mergeLegacyTodos(tasks, 'not an array')).toBe(tasks);
    expect(mergeLegacyTodos(tasks, { nope: true })).toBe(tasks);
  });

  it('appends legacy todos after the existing tasks', () => {
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

  it('leaves migrated todos undated and unlinked', () => {
    const merged = mergeLegacyTodos([], [{ id: '1', text: 'x', done: false }]);

    // Without a due date or event id, a migrated todo stays local.
    expect(merged[0].due).toBe('');
    expect(merged[0].eventId).toBeUndefined();
  });

  it('does not migrate the same todo twice', () => {
    const todos = [{ id: '1', text: 'Once', done: false }];

    const migratedOnce = mergeLegacyTodos([], todos);
    const migratedTwice = mergeLegacyTodos(migratedOnce, todos);

    expect(migratedTwice).toHaveLength(1);
  });

  it('skips malformed entries but keeps the good ones', () => {
    const merged = mergeLegacyTodos(
      [],
      [
        { id: '1', text: 'Good', done: false },
        { text: 'No id' },
        null,
        42,
        { id: '2', text: 'Also good', done: false },
      ],
    );

    expect(textsOf(merged)).toEqual(['Good', 'Also good']);
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

    expect(textsOf(sorted)).toEqual(['Open', 'Done']);
  });

  it('orders dated tasks by due date, ahead of undated ones', () => {
    const sorted = sortTasks([
      task({ id: 'a', text: 'No date' }),
      task({ id: 'b', text: 'Later', due: '2026-08-05T10:00' }),
      task({ id: 'c', text: 'Sooner', due: '2026-08-04T10:00' }),
    ]);

    expect(textsOf(sorted)).toEqual(['Sooner', 'Later', 'No date']);
  });

  it('breaks ties on text so renders are stable', () => {
    const sorted = sortTasks([task({ id: 'a', text: 'B' }), task({ id: 'b', text: 'A' })]);

    expect(textsOf(sorted)).toEqual(['A', 'B']);
  });
});
