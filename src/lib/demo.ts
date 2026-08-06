/**
 * The sample dashboard a visitor sees before they have an account.
 *
 * The demo is not a screenshot or a mock: it is the real `Dashboard`, with real
 * widgets, rendered under its own storage scope. Everything works — ticking a
 * task, dragging a panel, switching the theme — and none of it can touch a
 * signed-in account's data, because `useLocalStorage` namespaces every key by
 * the surrounding scope and this one is {@link DEMO_SCOPE}.
 *
 * Dates are computed from `now` rather than hard-coded, so the sample day is
 * always *today*. A demo showing a schedule from last spring reads as abandoned.
 */

import type { Reminder } from './gcalSync';

/**
 * Storage namespace for the demo.
 *
 * Contains the separator `useLocalStorage` uses, so `adoptLegacyKeys` treats
 * these as already-scoped and will never migrate them into a real account on
 * first sign-in — which is exactly what we want: the demo must not follow
 * someone into their dashboard.
 */
export const DEMO_SCOPE = 'demo';

/** Prefix every demo key carries in `localStorage`. */
const PREFIX = `${DEMO_SCOPE}:`;

/** Formats an offset from `now` as the `datetime-local` value tasks store. */
function dueAt(now: number, minutes: number): string {
  const d = new Date(now + minutes * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Today's `YYYY-MM-DD` in local time — the key the daily focus expires against. */
function todayKey(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * A plausible Tuesday.
 *
 * Chosen to exercise the parts of the dashboard that only look interesting with
 * real data in them: something overdue so the stat strip colours, something due
 * shortly so "next up" has a countdown, something already done, and something
 * undated so the agenda's "no place on the timeline" case shows.
 *
 * @param now - Epoch ms the sample day is built around. Injected so the fixture
 *   is reproducible in a test.
 */
export function demoTasks(now: number): Reminder[] {
  return [
    { id: 'demo-1', text: 'Send the Q3 deck to Priya', due: dueAt(now, -90), done: false },
    { id: 'demo-2', text: 'Stand-up', due: dueAt(now, 35), done: false },
    { id: 'demo-3', text: 'Review the pull request', due: dueAt(now, 150), done: false },
    { id: 'demo-4', text: 'Book the dentist', due: dueAt(now, 320), done: false },
    { id: 'demo-5', text: 'Water the plants', due: '', done: false },
    { id: 'demo-6', text: 'Reply to the landlord', due: dueAt(now, -240), done: true },
  ];
}

/**
 * Every key the demo seeds, already JSON-encoded the way `useLocalStorage`
 * stores them.
 *
 * @param now - Epoch ms to build the sample day around.
 */
export function demoData(now: number): Record<string, string> {
  return {
    'user.name': JSON.stringify('Alex'),
    layout: JSON.stringify(['reminders', 'calendar', 'weather', 'news', 'notes', 'youtube']),
    reminders: JSON.stringify(demoTasks(now)),
    focus: JSON.stringify({ date: todayKey(now), text: 'Finish the Q3 deck' }),
    'notes.text': JSON.stringify(
      'Ideas for the offsite\n\n- Somewhere with a kitchen\n- Two half-days, not one long one\n- Ask Sam about the venue near the park',
    ),
    'today.showFocus': JSON.stringify(true),
    'weather.place': JSON.stringify({
      name: 'San Diego',
      latitude: 32.7157,
      longitude: -117.1611,
    }),
    // Give the grid some variety so the demo shows panels at more than one size.
    'widget.sizes': JSON.stringify({
      reminders: { cols: 2, height: null },
      calendar: { cols: 2, height: null },
      weather: { cols: 1, height: null },
      news: { cols: 2, height: null },
      notes: { cols: 1, height: null },
      youtube: { cols: 2, height: null },
    }),
    // The retired To-do list never existed here, so skip the one-time merge
    // rather than letting it run against an empty namespace.
    'tasks.mergedTodos': JSON.stringify(true),
  };
}

/** Whether the demo namespace already holds anything. */
export function isDemoSeeded(): boolean {
  try {
    return Object.keys(window.localStorage).some((key) => key.startsWith(PREFIX));
  } catch {
    return false;
  }
}

/**
 * Fills the demo namespace, leaving alone anything already there.
 *
 * Only-if-absent on purpose: a visitor who rearranges the demo and then reloads
 * should find their arrangement, not a reset. {@link clearDemo} is the way back
 * to a fresh one.
 *
 * @param now - Epoch ms to build the sample day around.
 */
export function seedDemo(now: number = Date.now()): void {
  try {
    for (const [key, value] of Object.entries(demoData(now))) {
      if (window.localStorage.getItem(PREFIX + key) === null) {
        window.localStorage.setItem(PREFIX + key, value);
      }
    }
  } catch {
    // Storage unavailable (private mode). The dashboard still renders from its
    // own defaults; the demo is just less furnished.
  }
}

/** Removes everything the demo wrote, including whatever the visitor changed. */
export function clearDemo(): void {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    // Nothing readable to clear.
  }
}
