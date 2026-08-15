/**
 * The morning brief: one paragraph of the day, templated in the browser.
 *
 * Everything here is a pure function of the agenda, the mail ranking, and `now`
 * — there is no model behind the prose and no request behind the facts. The
 * sentences are chosen from a small set by measuring the calendar, which is the
 * whole design: a brief that reads as if it were written is worth nothing if it
 * cannot be checked, and this one can be read back off the numbers below
 * (ADR 0001 — nothing leaves the page).
 *
 * It composes rather than collects. The two inputs already exist and are already
 * rendered elsewhere — {@link AgendaItem} in the Today zone, {@link RankedMail}
 * in the Mail panel — so this module deliberately defines no shape of its own
 * for either, and the mail lines reuse the ranking's own `reason` text rather
 * than re-deriving why a message matters (ADR 0010 owns that judgement).
 *
 * Two conventions carried from `agenda.ts`, for the same reasons:
 *
 * - **`now` is a parameter**, never `Date.now()`, so a day classifies the same
 *   way in a test as it does at 6am.
 * - **Dates are local throughout.** A day is the local calendar day, because
 *   that is the day the person having it is in.
 */

import { occursOn, sortAgenda, startOfDay, type AgendaItem } from './agenda';
import { notable, TOP_N, type RankedMail } from './importantMail';

/** One day in ms. */
const DAY_MS = 86_400_000;

// --- Where the lines between days fall ---------------------------------------
//
// Read against each other rather than as absolutes. The only claim being made
// is ordering: five hours of meetings is a heavier day than ninety minutes of
// them, and a day with five separate commitments is heavy however short they
// are, because the cost of a commitment is not only its length.

/** Minutes of the day spoken for before it counts as heavy. */
export const HEAVY_MINUTES = 300;

/**
 * Commitments before a day counts as heavy regardless of their length.
 *
 * Five fifteen-minute calls is seventy-five minutes and a day you cannot do
 * anything else in. Duration alone would call that open, which is why this is a
 * second, independent route to `heavy`.
 */
export const HEAVY_COUNT = 5;

/** Minutes of the day spoken for below which it counts as open. */
export const OPEN_MINUTES = 90;

/**
 * Commitments above which a day is not open however short they are — the
 * mirror of {@link HEAVY_COUNT}. Three scattered things is a day with a shape.
 */
export const OPEN_COUNT = 2;

/** The shortest gap worth calling a clear stretch. */
export const CLEAR_MINUTES = 45;

/** How the day classifies, from calendar load alone. */
export type DayLoad = 'heavy' | 'normal' | 'open';

/** A run of unbooked time inside the day. */
export interface ClearStretch {
  /** Epoch ms the stretch begins. */
  start: number;
  /** Epoch ms the stretch ends. */
  end: number;
}

/** What the calendar says about today, before any of it is put into words. */
export interface DayMeasure {
  /** Timed events occurring today, sorted. All-day events are not load. */
  events: AgendaItem[];
  /** Minutes today that are spoken for, overlaps counted once. */
  bookedMinutes: number;
  /** The longest clear stretch worth mentioning, or `null`. */
  clear: ClearStretch | null;
  /** Epoch ms of the first commitment, clipped to today. */
  first: number | null;
  /** Epoch ms the last commitment ends, clipped to today. */
  last: number | null;
}

/** The brief itself: prose, plus the picks it points at. */
export interface MorningBrief {
  /** How the day classified. Drives the headline and the panel's accent. */
  load: DayLoad;
  /** One warm, plain line naming the day. */
  headline: string;
  /** Plain sentences on the shape of the day. Empty when there is no shape. */
  shape: string[];
  /**
   * Up to {@link TOP_N} picks off the existing ranking, each carrying its own
   * `reason`. Empty when nothing cleared the ranking's floor, and when the
   * inbox was never read.
   */
  mail: RankedMail[];
  /**
   * Nothing to report: a clear calendar and no mail worth naming. The
   * {@link MorningBrief.headline} is the one calm line saying so.
   */
  quiet: boolean;
}

/**
 * Clock time for an epoch, matching the Today zone's format.
 *
 * `agenda.timeLabel` says this for an {@link AgendaItem}, but a clear stretch
 * has no item behind it — it is a gap between two of them. So the brief formats
 * from epoch ms throughout rather than switching formatters halfway through a
 * paragraph.
 */
export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * A span of minutes in words: "40 minutes", "1 hour", "2½ hours".
 *
 * Rounded hard on purpose. "About 2½ hours" is what a person would say and is
 * the precision the underlying number deserves; "2 hours and 37 minutes" claims
 * an accuracy the calendar does not have.
 */
export function describeDuration(minutes: number): string {
  // Rounded first, then re-tested: 58 minutes rounds to 60, and "about 60
  // minutes" is not a thing anyone says out loud.
  const toFive = Math.max(5, Math.round(minutes / 5) * 5);
  if (toFive < 60) return `${toFive} minutes`;
  const halves = Math.round(minutes / 30);
  const whole = Math.floor(halves / 2);
  const half = halves % 2 === 1;
  const unit = whole === 1 && !half ? 'hour' : 'hours';
  return `${whole}${half ? '½' : ''} ${unit}`;
}

/** Today's timed calendar events, sorted. Tasks and all-day events are not load. */
export function todayEvents(agenda: AgendaItem[], now: number): AgendaItem[] {
  return sortAgenda(
    agenda.filter((item) => item.source === 'event' && !item.allDay && occursOn(item, now)),
  );
}

/**
 * The events' spans, clipped to today and merged.
 *
 * Merging is what stops a double-booked hour being counted twice — an invitation
 * accepted on top of a meeting does not make the day two hours longer — and it
 * is also what makes the gaps between the merged blocks real free time rather
 * than the space between two overlapping events.
 */
function busyIntervals(events: AgendaItem[], now: number): ClearStretch[] {
  const from = startOfDay(now);
  const to = from + DAY_MS;

  const clipped = events
    .map((event) => ({
      start: Math.max(event.start, from),
      end: Math.min(Math.max(event.end, event.start), to),
    }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);

  const merged: ClearStretch[] = [];
  for (const span of clipped) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/**
 * The longest unbooked run *between* the day's commitments.
 *
 * Strictly between, which is the whole of the definition. The obvious
 * alternative — measure against working hours, so the time before the first
 * commitment and after the last one counts too — was tried and is wrong here for
 * two reasons. It needs a working day invented out of nothing (this panel has no
 * settings, so 8-to-6 would be an opinion imposed on everyone), and the edges it
 * adds are already spoken for: the two sentences either side of this one say
 * when the day starts and when it is done. A brief that reads "it's all done by
 * 4:00 PM" and then offers "4:00 PM to 6:00 PM" as your longest clear stretch is
 * arguing with itself.
 *
 * So a day with one commitment has no clear stretch, and says so by omission —
 * the rest of it being free is what "it's all done by four" already told you.
 *
 * Ties go to the earlier stretch, so the answer is stable and reads forwards.
 *
 * @returns The stretch, or `null` when no gap reaches {@link CLEAR_MINUTES} — a
 *   day with no room in it should say nothing rather than offer a gap too short
 *   to use.
 */
export function longestClearStretch(events: AgendaItem[], now: number): ClearStretch | null {
  const busy = busyIntervals(events, now);

  let best: ClearStretch | null = null;
  for (let i = 1; i < busy.length; i += 1) {
    const gap = { start: busy[i - 1].end, end: busy[i].start };
    if (!best || gap.end - gap.start > best.end - best.start) best = gap;
  }

  if (!best || best.end - best.start < CLEAR_MINUTES * 60_000) return null;
  return best;
}

/** Measures today off the agenda, without saying anything about it yet. */
export function measureDay(agenda: AgendaItem[], now: number): DayMeasure {
  const events = todayEvents(agenda, now);
  const busy = busyIntervals(events, now);
  const bookedMinutes = busy.reduce((sum, span) => sum + (span.end - span.start) / 60_000, 0);

  return {
    events,
    bookedMinutes,
    clear: events.length > 0 ? longestClearStretch(events, now) : null,
    first: busy.length > 0 ? busy[0].start : null,
    last: busy.length > 0 ? busy[busy.length - 1].end : null,
  };
}

/**
 * Classifies the day from calendar load alone.
 *
 * Deliberately blind to tasks and mail. A day is heavy because of what is
 * already committed to it, and folding a long to-do list into that would make
 * the headline a judgement on how much you have to do rather than a statement
 * of how much of the day is already gone.
 *
 * Heavy is tested first, so five short commitments read as heavy rather than
 * open — see {@link HEAVY_COUNT}.
 */
export function classifyDay(measure: DayMeasure): DayLoad {
  const { events, bookedMinutes } = measure;
  if (bookedMinutes >= HEAVY_MINUTES || events.length >= HEAVY_COUNT) return 'heavy';
  if (bookedMinutes < OPEN_MINUTES && events.length <= OPEN_COUNT) return 'open';
  return 'normal';
}

/** `3 commitments`, or `1 commitment`. */
function commitments(count: number): string {
  return `${count} ${count === 1 ? 'commitment' : 'commitments'}`;
}

/** The one line naming the day. Warm, plain, and about load only. */
function headlineFor(load: DayLoad, measure: DayMeasure): string {
  const { events, bookedMinutes } = measure;
  const spoken = describeDuration(bookedMinutes);

  if (load === 'heavy') {
    return `Today is a heavy one — ${commitments(events.length)}, about ${spoken} of it spoken for.`;
  }
  if (load === 'normal') {
    return `A steady day — ${commitments(events.length)}, about ${spoken} in all.`;
  }
  if (events.length === 0) return 'Today is wide open — nothing on the calendar.';
  return `A quiet day — ${commitments(events.length)}, and the rest of it is yours.`;
}

/**
 * The shape of the day: where it starts, where the room in it is, when it ends.
 *
 * Tense is chosen against `now` rather than written for the morning. The panel
 * sits on a dashboard that stays open, and a brief still saying "the day starts
 * with" at four in the afternoon is wrong in the one way prose cannot hide.
 */
function shapeOf(measure: DayMeasure, now: number): string[] {
  const { events, clear, first, last } = measure;
  if (events.length === 0 || first === null || last === null) return [];

  const lines = [
    now < first
      ? `It starts with ${events[0].title} at ${clock(first)}.`
      : `It started with ${events[0].title} at ${clock(first)}.`,
  ];

  if (clear) {
    const span = describeDuration((clear.end - clear.start) / 60_000);
    lines.push(`The longest clear stretch is ${span}, ${clock(clear.start)} to ${clock(clear.end)}.`);
  }

  // Silent when the day is one instant long — "it starts at 9 and ends at 9"
  // is a sentence that says nothing the line above it did not.
  if (last > first) {
    lines.push(now < last ? `It’s all done by ${clock(last)}.` : `It wrapped at ${clock(last)}.`);
  }

  return lines;
}

/**
 * The calm line for a day with nothing in it.
 *
 * Not an apology and not a placeholder: an empty calendar and a quiet inbox is
 * a good outcome, and the panel says so plainly rather than dressing the space
 * up with something to do.
 *
 * @param readMail - Whether the inbox was actually read. When it was not — Gmail
 *   is not connected, or the read failed — the line must not claim anything
 *   about mail it never looked at.
 */
function quietLine(readMail: boolean): string {
  return readMail
    ? 'Nothing on the calendar, and nothing in your mail that needs you. Take the day as it comes.'
    : 'Nothing on the calendar today. Take it as it comes.';
}

/**
 * Builds the day's brief.
 *
 * @param agenda - The merged agenda from `useDashboardData`. Only its calendar
 *   events are read; tasks belong to the Today zone.
 * @param mail - A ranking from `rankMail`, or `null` when the inbox was not
 *   read at all. The distinction is load-bearing: `[]` means "nothing in your
 *   mail needs you" and `null` means "your mail was not looked at", and only one
 *   of those is something the brief may say out loud.
 * @param now - Epoch ms. Injected rather than read, so a brief is reproducible.
 */
export function buildBrief(
  agenda: AgendaItem[],
  mail: RankedMail[] | null,
  now: number,
): MorningBrief {
  const measure = measureDay(agenda, now);
  // Only what cleared the ranking's own floor — the brief has three lines to
  // spend and no business padding them with mail ADR 0010 already judged.
  const picks = mail ? notable(mail).slice(0, TOP_N) : [];

  if (measure.events.length === 0 && picks.length === 0) {
    return {
      load: 'open',
      headline: quietLine(mail !== null),
      shape: [],
      mail: [],
      quiet: true,
    };
  }

  const load = classifyDay(measure);
  return {
    load,
    headline: headlineFor(load, measure),
    shape: shapeOf(measure, now),
    mail: picks,
    quiet: false,
  };
}
