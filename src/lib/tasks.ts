/**
 * The one-time merge of the old To-do widget's data into the task list.
 *
 * To-do and Reminders were always the same shape — a `Task` was a `Reminder`
 * without a due date — so the dashboard offered two panels for one idea. This
 * folds them into a single list where an undated task stays local and a dated
 * one syncs to Google Calendar, which `gcalSync.ts` already handles.
 *
 * The merge is pure so it can be tested, and it never removes the legacy
 * `todos` key: that entry stays in `localStorage` untouched as a manual rollback
 * path if someone needs their old list back.
 */

import type { Reminder } from './gcalSync';

/** The shape the retired To-do widget persisted under the `todos` key. */
export interface LegacyTodo {
  id: string;
  text: string;
  done: boolean;
}

/** Ids carry a prefix so a legacy todo can never collide with a real reminder. */
const PREFIX = 'todo-';

/** Whether a value read from storage is usable as a legacy todo. */
function isLegacyTodo(value: unknown): value is LegacyTodo {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Partial<LegacyTodo>;
  return typeof t.id === 'string' && typeof t.text === 'string';
}

/**
 * Appends legacy todos to the task list as undated tasks.
 *
 * Idempotent: a todo whose migrated id is already present is skipped, so running
 * this twice cannot duplicate anything. Malformed entries are dropped rather
 * than throwing — this runs during the first render of the dashboard, and a
 * corrupt storage value should not blank the page.
 *
 * @param tasks - The current task list.
 * @param todos - Whatever was parsed out of the legacy `todos` key.
 * @returns The merged list, or the original array when there is nothing to do.
 */
export function mergeLegacyTodos(tasks: Reminder[], todos: unknown): Reminder[] {
  if (!Array.isArray(todos) || todos.length === 0) return tasks;

  const existing = new Set(tasks.map((t) => t.id));
  const migrated: Reminder[] = [];

  for (const raw of todos) {
    if (!isLegacyTodo(raw)) continue;
    const id = `${PREFIX}${raw.id}`;
    if (existing.has(id)) continue;
    existing.add(id);
    migrated.push({
      id,
      text: raw.text,
      // Undated: stays local, never pushed to Calendar.
      due: '',
      done: raw.done === true,
    });
  }

  return migrated.length > 0 ? [...tasks, ...migrated] : tasks;
}

/**
 * Orders the task list for display: unfinished first, then soonest due, with
 * undated tasks after dated ones and a stable text tiebreak.
 */
export function sortTasks(tasks: Reminder[]): Reminder[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (!a.due !== !b.due) return a.due ? -1 : 1;
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    return a.text.localeCompare(b.text);
  });
}
