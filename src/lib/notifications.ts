/**
 * Which tasks are worth interrupting the user for, and what the interruption says.
 *
 * A dated task is only useful if something tells you about it, and until now the
 * only thing that did was the dashboard itself — which means it told you only
 * while you were already looking at it. This module decides what to raise; the
 * hook in `useTaskNotifications.ts` owns permission and delivery.
 *
 * Two rules shape everything here:
 *
 * - **Tasks only.** The agenda merges calendar events in, but Google already
 *   alerts on its own events. Notifying again would double up on every meeting,
 *   so events are filtered out rather than treated as a missing feature.
 * - **Recent only.** A tab can sleep for hours, so "everything still overdue"
 *   would greet a returning user with a burst of alerts for things they either
 *   dealt with or consciously let slide. {@link GRACE_MS} bounds that: past the
 *   window a task is simply overdue, which the Today zone's stat strip already
 *   says without interrupting anyone.
 *
 * Everything is pure and takes the current time as a parameter, matching
 * `agenda.ts` — the notification rules are the part most worth testing and the
 * part that most needs a clock it can lie to.
 */

import type { AgendaItem } from './agenda';

/**
 * How long after its due time a task is still worth interrupting for.
 *
 * Long enough to survive a throttled or frozen background tab, short enough that
 * a notice always reads as "this just came due" rather than as a digest of the
 * morning.
 */
export const GRACE_MS = 30 * 60_000;

/** Separates an item's key from the due time it was notified for. */
const AT = '@';

/**
 * The ledger entry for one notice.
 *
 * Deliberately id *and* due time: moving a task's due date should arm it again
 * rather than be silently swallowed by the record of the old time having fired.
 */
export function noticeKey(item: AgendaItem): string {
  return `${item.key}${AT}${item.start}`;
}

/** One notification, ready to be handed to the browser. */
export interface DueNotice {
  /** Ledger key, also used as the notification `tag` so the OS de-dupes too. */
  key: string;
  /** The task's text. */
  title: string;
  /** How late it is, as a short phrase. */
  body: string;
}

/**
 * How late a task is, in words.
 *
 * Not `agenda.relativeLabel`, which is written for a row you are looking at and
 * renders a task due this second as "less than a minute ago". A notification
 * arrives *because* something just came due, so it says so.
 */
export function noticeBody(item: AgendaItem, at: number): string {
  const mins = Math.floor((at - item.start) / 60_000);
  return mins < 1 ? 'Due now' : `Due ${mins}m ago`;
}

/**
 * The notices owed right now: unfinished tasks whose due time has passed inside
 * {@link GRACE_MS} and that have not already been raised.
 *
 * @param items - The merged agenda. Events are ignored; see the module note.
 * @param at - The current time.
 * @param sent - Ledger of keys already raised, from {@link pruneSent}.
 */
export function pendingNotices(
  items: AgendaItem[],
  at: number,
  sent: readonly string[],
): DueNotice[] {
  const seen = new Set(sent);
  return items
    .filter(
      (item) =>
        item.source === 'task' &&
        !item.done &&
        item.start <= at &&
        item.start > at - GRACE_MS,
    )
    .map((item) => ({
      key: noticeKey(item),
      // A task with no text still has a due time worth honouring, and a
      // notification with an empty title renders as a blank box.
      title: item.title.trim() || 'Task due',
      body: noticeBody(item, at),
    }))
    .filter((notice) => !seen.has(notice.key));
}

/**
 * Drops ledger entries that can no longer match anything.
 *
 * The ledger persists, so without this it would grow by one entry per task
 * forever. Once a key's due time falls out of the grace window
 * {@link pendingNotices} can never select it again, which makes the entry dead
 * weight — and lets this be decided from the key alone, with no need to hold on
 * to the tasks it came from. Unparseable entries are dropped for the same
 * reason: nothing can ever match them.
 */
export function pruneSent(sent: readonly string[], at: number): string[] {
  return sent.filter((key) => {
    const due = Number(key.slice(key.lastIndexOf(AT) + 1));
    return Number.isFinite(due) && due > at - GRACE_MS;
  });
}
