import { createContext, useContext } from 'react';
import type { CalendarSync } from './useCalendarSync';
import type { UpcomingEvents } from './useUpcomingEvents';
import type { AgendaCounts, AgendaItem } from '../lib/agenda';
import type { Reminder } from '../lib/gcalSync';

/**
 * Everything the dashboard's commitment surfaces read and write.
 *
 * This exists because `useLocalStorage` has no cross-instance synchronisation:
 * two components calling it with the same key get two independent React states
 * that both write the same slot, last writer wins. The Today zone and the Tasks
 * panel therefore cannot each own the list — they would silently diverge until a
 * reload. The same goes for `useUpcomingEvents`, where a second instance would
 * mean a second access-token request and a second poll timer.
 *
 * So state is owned once, by `DashboardDataProvider`, and handed to everyone.
 */
export interface DashboardData {
  /** The unified task list (formerly Reminders + To-do). */
  tasks: Reminder[];
  /** Replaces the task list. Accepts an updater, like `useState`. */
  setTasks: (next: Reminder[] | ((prev: Reminder[]) => Reminder[])) => void;
  /** Marks a task done/undone by id — the write-through path from the Today zone. */
  toggleTask: (id: string) => void;
  /** Two-way sync between dated tasks and Google Calendar. */
  cal: CalendarSync;
  /** Read-only view of the user's real calendars. */
  upcoming: UpcomingEvents;
  /** Calendar events and dated tasks, merged and sorted. */
  agenda: AgendaItem[];
  /** Aggregate figures for the Today zone's stat strip. */
  counts: AgendaCounts;
  /** Current time, advancing once a minute. Render from this, not `Date.now()`. */
  now: number;
}

export const DashboardDataContext = createContext<DashboardData | null>(null);

/**
 * Reads the shared dashboard state.
 *
 * @throws When called outside `DashboardDataProvider` — a widget that needs this
 *   data cannot fall back to its own copy without reintroducing the divergence
 *   the provider exists to prevent, so failing loudly is correct.
 */
export function useDashboardData(): DashboardData {
  const value = useContext(DashboardDataContext);
  if (!value) {
    throw new Error('useDashboardData must be used inside a <DashboardDataProvider>');
  }
  return value;
}
