/**
 * The unified commitment stream behind the Today zone.
 *
 * The dashboard has two places a commitment can live: Google Calendar events
 * (read-only, via `gcalEvents.ts`) and local tasks (`Reminder` in `gcalSync.ts`,
 * which may themselves be mirrored to Calendar). Before this module they were
 * only ever rendered as two separate lists, so answering "what do I owe today?"
 * meant reading two panels and merging them by hand.
 *
 * Everything here is pure and takes `now` as a parameter, so the Today zone can
 * be tested without touching the clock. Dates are handled in **local** time
 * throughout, matching `gcalEvents.localMidnight` — parsing an all-day date as
 * UTC lands it on the wrong day for anyone west of Greenwich.
 */

import { dayKey, type CalendarEvent } from './gcalEvents';
import type { Reminder } from './gcalSync';

const DAY_MS = 86_400_000;

/** Where an agenda item came from. Drives its icon and whether it can be ticked. */
export type AgendaSource = 'event' | 'task';

/** One commitment, normalised across calendar events and local tasks. */
export interface AgendaItem {
  /** Unique across sources — ids can collide between a calendar and the task list. */
  key: string;
  source: AgendaSource;
  /** Id of the owning record, for writing a completion back to its widget. */
  id: string;
  title: string;
  /** Start as epoch ms; local midnight for all-day events. */
  start: number;
  /** End as epoch ms. Equal to `start` for tasks, which are instants. */
  end: number;
  /** Date-only event; sorts above timed items on the same day. */
  allDay: boolean;
  /** Tasks track completion locally. Always `false` for events. */
  done: boolean;
  /** Link to the event in Google Calendar, when it has one. */
  url?: string;
}

/** The aggregate figures the Today zone's stat strip reads. */
export interface AgendaCounts {
  /** Unfinished tasks due today. */
  remainingToday: number;
  /** Unfinished tasks whose due time has passed, on any day. */
  overdue: number;
  /** Events today that have not finished yet. */
  eventsLeft: number;
  /** Unfinished tasks with no due date at all — invisible to the timeline. */
  undated: number;
}

/** Local midnight starting the day that contains `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * The half-open span an item occupies. Tasks are instants, so they are widened
 * by 1ms — otherwise a task due at exactly local midnight would belong to no day.
 */
function spanEnd(item: AgendaItem): number {
  return Math.max(item.end, item.start + 1);
}

/** Whether an item overlaps the local day containing `dayMs`. */
export function occursOn(item: AgendaItem, dayMs: number): boolean {
  const from = startOfDay(dayMs);
  const to = from + DAY_MS;
  return item.start < to && spanEnd(item) > from;
}

/** Converts a calendar event into an agenda item. */
export function fromEvent(event: CalendarEvent): AgendaItem {
  return {
    key: `event:${event.calendarId}:${event.id}`,
    source: 'event',
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    done: false,
    url: event.htmlLink,
  };
}

/**
 * Converts a task into an agenda item.
 *
 * @returns `null` for tasks that cannot be placed on a timeline: deleted
 *   tombstones awaiting a sync, and undated tasks. Undated tasks are counted by
 *   {@link countAgenda} rather than dropped silently.
 */
export function fromTask(task: Reminder): AgendaItem | null {
  if (task.deleted || !task.due) return null;
  const start = new Date(task.due).getTime();
  if (Number.isNaN(start)) return null;
  return {
    key: `task:${task.id}`,
    source: 'task',
    id: task.id,
    title: task.text,
    start,
    end: start,
    allDay: false,
    done: task.done,
  };
}

/**
 * Orders the agenda: chronological, with all-day items pinned above timed ones
 * on the same day and a stable title tiebreak. Mirrors `sortEvents` in
 * `gcalEvents.ts` so the Today zone and the Calendar widget agree on order.
 */
export function sortAgenda(items: AgendaItem[]): AgendaItem[] {
  return [...items].sort((a, b) => {
    if (a.allDay !== b.allDay && dayKey(a.start) === dayKey(b.start)) {
      return a.allDay ? -1 : 1;
    }
    if (a.start !== b.start) return a.start - b.start;
    if (a.title !== b.title) return a.title.localeCompare(b.title);
    return a.key.localeCompare(b.key);
  });
}

/** Merges events and tasks into one sorted stream. */
export function buildAgenda(events: CalendarEvent[], tasks: Reminder[]): AgendaItem[] {
  const items = events.map(fromEvent);
  for (const task of tasks) {
    const item = fromTask(task);
    if (item) items.push(item);
  }
  return sortAgenda(items);
}

/** Everything overlapping today, including multi-day events that started earlier. */
export function todayItems(items: AgendaItem[], now: number): AgendaItem[] {
  return items.filter((item) => occursOn(item, now));
}

/** Whether a timed item has started but not yet finished. */
export function isInProgress(item: AgendaItem, now: number): boolean {
  return !item.allDay && item.start <= now && spanEnd(item) > now;
}

/**
 * The one thing to show as "next up": whatever is happening right now, else the
 * soonest thing still to come.
 *
 * Completed tasks are skipped — a ticked-off item is not what you do next. Items
 * already finished are skipped too, which is why this tests the end of the span
 * rather than the start.
 */
export function nextUp(items: AgendaItem[], now: number): AgendaItem | null {
  const live = items.filter((item) => !item.done && spanEnd(item) > now);
  return live.length > 0 ? live[0] : null;
}

/** Unfinished tasks whose due time has passed. Events are never "overdue". */
export function overdueItems(items: AgendaItem[], now: number): AgendaItem[] {
  return items.filter((item) => item.source === 'task' && !item.done && item.start < now);
}

/**
 * Aggregate figures for the stat strip.
 *
 * @param items - The merged agenda, as built by {@link buildAgenda}.
 * @param tasks - The raw task list, needed to count undated tasks — they have no
 *   agenda item by design, so they cannot be counted from `items` alone.
 */
export function countAgenda(
  items: AgendaItem[],
  tasks: Reminder[],
  now: number,
): AgendaCounts {
  const today = todayItems(items, now);
  return {
    remainingToday: today.filter((i) => i.source === 'task' && !i.done).length,
    overdue: overdueItems(items, now).length,
    eventsLeft: today.filter((i) => i.source === 'event' && spanEnd(i) > now).length,
    undated: tasks.filter((t) => !t.deleted && !t.due && !t.done).length,
  };
}

/**
 * A short relative label for how far away an item is: "now", "in 40m", "in 3h",
 * "2d ago". Deliberately coarse — the Today zone re-renders once a minute, so
 * second-level precision would be a lie.
 */
export function relativeLabel(item: AgendaItem, now: number): string {
  if (isInProgress(item, now)) return 'now';

  const delta = item.start - now;
  const past = delta < 0;
  const mins = Math.round(Math.abs(delta) / 60_000);

  let value: string;
  if (mins < 1) value = 'less than a minute';
  else if (mins < 60) value = `${mins}m`;
  else if (mins < 60 * 24) {
    const hours = Math.round(mins / 60);
    value = `${hours}h`;
  } else {
    const days = Math.round(mins / (60 * 24));
    value = `${days}d`;
  }

  return past ? `${value} ago` : `in ${value}`;
}

/** Clock time for an item, or "All day" for date-only events. */
export function timeLabel(item: AgendaItem): string {
  if (item.allDay) return 'All day';
  return new Date(item.start).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}
