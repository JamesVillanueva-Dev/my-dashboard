import { describe, it, expect } from 'vitest';
import {
  CLEAR_MINUTES,
  HEAVY_COUNT,
  HEAVY_MINUTES,
  OPEN_COUNT,
  OPEN_MINUTES,
  buildBrief,
  classifyDay,
  clock,
  describeDuration,
  longestClearStretch,
  measureDay,
  todayEvents,
} from './morningBrief';
import type { AgendaItem } from './agenda';
import { FLOOR, TOP_N, type RankedMail } from './importantMail';
import type { MailSummary } from './gmail';

const MINUTE = 60_000;

/** The day every fixture below sits on — a fixed local date, so nothing drifts. */
const DAY = new Date(2026, 0, 15);

/** Epoch ms for a local time on the fixture day. */
function at(hour: number, minute = 0): number {
  return new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate(), hour, minute).getTime();
}

/** A timed calendar event on the fixture day. */
function event(title: string, startHour: number, minutes: number): AgendaItem {
  const start = at(startHour);
  return {
    key: `event:cal:${title}`,
    source: 'event',
    id: title,
    title,
    start,
    end: start + minutes * MINUTE,
    allDay: false,
    done: false,
  };
}

/** `count` short back-to-back-ish events, for the count-based boundary. */
function shortEvents(count: number, minutes = 15): AgendaItem[] {
  return Array.from({ length: count }, (_, i) => event(`Call ${i + 1}`, 9 + i, minutes));
}

/** A dated task. Present in the agenda, and deliberately not calendar load. */
function task(title: string, startHour: number): AgendaItem {
  return {
    key: `task:${title}`,
    source: 'task',
    id: title,
    title,
    start: at(startHour),
    end: at(startHour),
    allDay: false,
    done: false,
  };
}

/** An all-day event. Occupies the day without booking any of it. */
function allDay(title: string): AgendaItem {
  return {
    ...event(title, 0, 0),
    start: at(0),
    end: at(0) + 86_400_000,
    allDay: true,
  };
}

/** A ranked message, above the ranking's floor unless told otherwise. */
function pick(id: string, overrides: Partial<RankedMail> = {}): RankedMail {
  const message: MailSummary = {
    id,
    from: `Priya <${id}@example.com>`,
    subject: `Subject ${id}`,
    snippet: 'preview',
    receivedAt: at(8),
    unread: true,
    to: ['you@example.com'],
    cc: [],
    deliveredTo: [],
    listHeaders: false,
    autoHeaders: false,
    threaded: false,
    labels: { important: false, starred: false, updates: false, forums: false },
  };
  return {
    message,
    reason: `Because of ${id}`,
    score: 40,
    merit: FLOOR + 10,
    signals: [],
    ...overrides,
  };
}

describe('describeDuration', () => {
  it('says minutes below the hour, rounded to something a person would say', () => {
    expect(describeDuration(42)).toBe('40 minutes');
    expect(describeDuration(47)).toBe('45 minutes');
  });

  it('reaches for the hour rather than saying "60 minutes"', () => {
    expect(describeDuration(58)).toBe('1 hour');
  });

  it('never rounds a real span away to nothing', () => {
    expect(describeDuration(1)).toBe('5 minutes');
  });

  it('says hours above it, to the nearest half', () => {
    expect(describeDuration(60)).toBe('1 hour');
    expect(describeDuration(95)).toBe('1½ hours');
    expect(describeDuration(120)).toBe('2 hours');
    expect(describeDuration(310)).toBe('5 hours');
  });
});

describe('todayEvents', () => {
  it('reads calendar events on the day and sorts them', () => {
    const items = [event('Later', 15, 30), event('Earlier', 9, 30)];

    expect(todayEvents(items, at(12)).map((e) => e.title)).toEqual(['Earlier', 'Later']);
  });

  it('leaves tasks out — a to-do list is not calendar load', () => {
    expect(todayEvents([task('Email Dana', 10)], at(12))).toEqual([]);
  });

  it('leaves all-day events out, since they book none of the day', () => {
    expect(todayEvents([allDay('Conference')], at(12))).toEqual([]);
  });

  it('leaves another day alone', () => {
    const tomorrow = at(10) + 86_400_000;

    expect(todayEvents([{ ...event('Tomorrow', 10, 60), start: tomorrow, end: tomorrow }], at(12)))
      .toEqual([]);
  });
});

describe('measureDay', () => {
  it('counts an overlap once, so a double-booked hour is one hour', () => {
    const measure = measureDay([event('A', 9, 120), event('B', 10, 120)], at(12));

    expect(measure.bookedMinutes).toBe(180);
  });

  it('reports where the day starts and ends', () => {
    const measure = measureDay([event('Standup', 9, 30), event('Review', 16, 60)], at(12));

    expect(measure.first).toBe(at(9));
    expect(measure.last).toBe(at(17));
  });

  it('has nothing to report on a clear day', () => {
    const measure = measureDay([], at(12));

    expect(measure).toMatchObject({ events: [], bookedMinutes: 0, clear: null, first: null, last: null });
  });
});

describe('classifyDay boundaries', () => {
  /** Classifies a day made of one event of `minutes`, which is the minutes axis. */
  const byMinutes = (minutes: number) => classifyDay(measureDay([event('Block', 9, minutes)], at(12)));

  it('calls the day heavy at exactly the heavy threshold', () => {
    expect(byMinutes(HEAVY_MINUTES)).toBe('heavy');
  });

  it('stops short of heavy one minute below it', () => {
    expect(byMinutes(HEAVY_MINUTES - 1)).toBe('normal');
  });

  it('calls the day heavy on commitment count alone, however short they are', () => {
    const events = shortEvents(HEAVY_COUNT);

    expect(measureDay(events, at(12)).bookedMinutes).toBeLessThan(HEAVY_MINUTES);
    expect(classifyDay(measureDay(events, at(12)))).toBe('heavy');
  });

  it('stops short of heavy one commitment below that', () => {
    expect(classifyDay(measureDay(shortEvents(HEAVY_COUNT - 1), at(12)))).toBe('normal');
  });

  it('calls the day open one minute below the open threshold', () => {
    expect(byMinutes(OPEN_MINUTES - 1)).toBe('open');
  });

  it('stops calling it open at exactly the open threshold', () => {
    expect(byMinutes(OPEN_MINUTES)).toBe('normal');
  });

  it('calls an empty calendar open', () => {
    expect(classifyDay(measureDay([], at(12)))).toBe('open');
  });

  it('is not open once there are more than a couple of things, however short', () => {
    const events = shortEvents(OPEN_COUNT + 1, 20);

    expect(measureDay(events, at(12)).bookedMinutes).toBeLessThan(OPEN_MINUTES);
    expect(classifyDay(measureDay(events, at(12)))).toBe('normal');
  });

  it('is still open at the count limit', () => {
    expect(classifyDay(measureDay(shortEvents(OPEN_COUNT, 20), at(12)))).toBe('open');
  });

  it('ignores tasks and all-day events when weighing the day', () => {
    const items = [allDay('Conference'), ...Array.from({ length: 6 }, (_, i) => task(`T${i}`, 9 + i))];

    expect(classifyDay(measureDay(items, at(12)))).toBe('open');
  });
});

describe('longestClearStretch', () => {
  it('finds the gap between two commitments', () => {
    const clear = longestClearStretch([event('Standup', 9, 30), event('Review', 14, 60)], at(12));

    expect(clear).toEqual({ start: at(9, 30), end: at(14) });
  });

  it('measures between commitments, never off the ends of the day', () => {
    // The rest of the day after a single 9:30 finish is free, but that is what
    // "it's all done by 9:30" says; this sentence would only repeat it.
    expect(longestClearStretch([event('Standup', 9, 30)], at(12))).toBeNull();
  });

  it('has nothing to measure on an empty calendar', () => {
    expect(longestClearStretch([], at(12))).toBeNull();
  });

  it('treats back-to-back commitments as one block, with no gap between them', () => {
    expect(longestClearStretch([event('A', 9, 60), event('B', 10, 60)], at(12))).toBeNull();
  });

  it('sees past an overlap to the real gap behind it', () => {
    // A and B overlap into one 9:00–12:00 block, so the only gap is 12:00–15:00.
    const events = [event('A', 9, 120), event('B', 10, 120), event('C', 15, 60)];

    expect(longestClearStretch(events, at(12))).toEqual({ start: at(12), end: at(15) });
  });

  it('says nothing when no gap is long enough to use', () => {
    const events = [event('A', 8, 120), event('B', 10, 30), event('C', 11, 60)];

    // 10:30–11:00 is half an hour: real, and not a stretch anyone can use.
    expect(longestClearStretch(events, at(12))).toBeNull();
  });

  it('reports a gap exactly at the shortest worth mentioning', () => {
    // 8:00–10:00, then 10:45 — the gap is CLEAR_MINUTES to the minute.
    const later = { ...event('B', 10, 60), start: at(10, CLEAR_MINUTES) };
    const events = [event('A', 8, 120), { ...later, end: later.start + 60 * MINUTE }];

    expect(longestClearStretch(events, at(12))).toEqual({
      start: at(10),
      end: at(10, CLEAR_MINUTES),
    });
  });

  it('takes the earlier of two equal gaps, so the answer reads forwards', () => {
    const events = [event('A', 9, 60), event('B', 12, 60), event('C', 15, 60)];

    expect(longestClearStretch(events, at(12))).toEqual({ start: at(10), end: at(12) });
  });
});

describe('buildBrief on a heavy day', () => {
  const events = [
    event('Standup', 9, 30),
    event('Design review', 10, 90),
    event('1:1 with Priya', 13, 60),
    event('Planning', 14, 120),
  ];

  it('names the day and how much of it is gone', () => {
    const brief = buildBrief(events, [], at(8));

    expect(brief.load).toBe('heavy');
    expect(brief.headline).toBe('Today is a heavy one — 4 commitments, about 5 hours of it spoken for.');
  });

  it('describes the shape: where it starts, the room in it, when it ends', () => {
    const brief = buildBrief(events, [], at(8));

    expect(brief.shape).toEqual([
      `It starts with Standup at ${clock(at(9))}.`,
      `The longest clear stretch is 1½ hours, ${clock(at(11, 30))} to ${clock(at(13))}.`,
      `It’s all done by ${clock(at(16))}.`,
    ]);
  });

  it('reads in the past tense once the day has moved on', () => {
    const brief = buildBrief(events, [], at(17));

    expect(brief.shape[0]).toBe(`It started with Standup at ${clock(at(9))}.`);
    expect(brief.shape[2]).toBe(`It wrapped at ${clock(at(16))}.`);
  });

  it('is never quiet when there is something on the calendar', () => {
    expect(buildBrief(events, [], at(8)).quiet).toBe(false);
  });

  it('carries no emoji', () => {
    const brief = buildBrief(events, [], at(8));

    expect([brief.headline, ...brief.shape].join(' ')).toMatch(/^[\p{L}\p{N}\p{P}\p{Zs}½]+$/u);
  });
});

describe('buildBrief on an open day', () => {
  it('says so plainly when the calendar is empty but the mail is not', () => {
    const brief = buildBrief([], [pick('a')], at(8));

    expect(brief.load).toBe('open');
    expect(brief.headline).toBe('Today is wide open — nothing on the calendar.');
    expect(brief.shape).toEqual([]);
    expect(brief.quiet).toBe(false);
  });

  it('counts the one or two things there are without calling the day busy', () => {
    const brief = buildBrief([event('Coffee', 11, 45)], [], at(8));

    expect(brief.headline).toBe('A quiet day — 1 commitment, and the rest of it is yours.');
  });
});

describe('buildBrief mail', () => {
  it('reuses the ranking’s own reason rather than writing a second one', () => {
    const brief = buildBrief([], [pick('a')], at(8));

    expect(brief.mail[0].reason).toBe('Because of a');
  });

  it('shows no more than the ranking’s own top count', () => {
    const brief = buildBrief([], ['a', 'b', 'c', 'd', 'e'].map((id) => pick(id)), at(8));

    expect(brief.mail).toHaveLength(TOP_N);
  });

  it('drops picks the ranking’s floor turned down', () => {
    const ranking = [pick('a'), pick('b', { merit: FLOOR - 1 })];

    expect(buildBrief([], ranking, at(8)).mail.map((m) => m.message.id)).toEqual(['a']);
  });
});

describe('buildBrief with nothing to report', () => {
  it('says one calm line, and nothing else', () => {
    const brief = buildBrief([], [], at(8));

    expect(brief.quiet).toBe(true);
    expect(brief.headline).toBe(
      'Nothing on the calendar, and nothing in your mail that needs you. Take the day as it comes.',
    );
    expect(brief.shape).toEqual([]);
    expect(brief.mail).toEqual([]);
  });

  it('treats a ranking of nothing but low scorers as nothing to report', () => {
    const brief = buildBrief([], [pick('a', { merit: FLOOR - 1 })], at(8));

    expect(brief.quiet).toBe(true);
  });

  it('claims nothing about mail it never read', () => {
    const brief = buildBrief([], null, at(8));

    expect(brief.quiet).toBe(true);
    expect(brief.headline).toBe('Nothing on the calendar today. Take it as it comes.');
    expect(brief.headline).not.toMatch(/mail/i);
  });

  it('still describes the day when the calendar has one, unread inbox or not', () => {
    const brief = buildBrief([event('Standup', 9, 30)], null, at(8));

    expect(brief.quiet).toBe(false);
    expect(brief.mail).toEqual([]);
  });
});
