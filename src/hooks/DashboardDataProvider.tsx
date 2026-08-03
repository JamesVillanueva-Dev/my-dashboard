import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { useCalendarSync } from './useCalendarSync';
import { useUpcomingEvents } from './useUpcomingEvents';
import { DashboardDataContext, type DashboardData } from './useDashboardData';
import { buildAgenda, countAgenda } from '../lib/agenda';
import { mergeLegacyTodos } from '../lib/tasks';
import type { Reminder } from '../lib/gcalSync';

/**
 * Owns the dashboard's shared task and calendar state and provides it to the tree.
 *
 * See {@link DashboardData} for why this ownership has to be central rather than
 * per-widget. This file holds only the component; the context, hook, and types
 * live in `useDashboardData.ts` so neither file mixes component and
 * non-component exports.
 *
 * It also performs the one-time merge of the retired To-do widget's data into the
 * task list (see `lib/tasks.ts`). That runs here rather than in a component
 * because it must happen before anything renders the list, and exactly once.
 */
export function DashboardDataProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useLocalStorage<Reminder[]>('reminders', []);
  const [legacyTodos] = useLocalStorage<unknown>('todos', null);
  const [merged, setMerged] = useLocalStorage<boolean>('tasks.mergedTodos', false);

  const upcoming = useUpcomingEvents();

  // Fold the old To-do list in, once. The `todos` key is deliberately left in
  // place as a manual rollback path.
  useEffect(() => {
    if (merged) return;
    setTasks((prev) => mergeLegacyTodos(prev, legacyTodos));
    setMerged(true);
  }, [merged, legacyTodos, setTasks, setMerged]);

  // Give the sync hook a live view of the tasks without stale closures.
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  const cal = useCalendarSync(
    () => tasksRef.current,
    (next) => setTasks(next),
  );

  const value = useMemo<DashboardData>(() => {
    const live = tasks.filter((t) => !t.deleted);
    const agenda = buildAgenda(upcoming.events, live);
    return {
      tasks,
      setTasks,
      toggleTask: (id) =>
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))),
      cal,
      upcoming,
      agenda,
      counts: countAgenda(agenda, live, upcoming.now),
      now: upcoming.now,
    };
  }, [tasks, setTasks, cal, upcoming]);

  return <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>;
}
