import { describe, it, expect } from 'vitest';
import { GRACE_MS, noticeBody, noticeKey, pendingNotices, pruneSent } from './notifications';
import type { AgendaItem } from './agenda';

/** A fixed "now" — every case below is written relative to it. */
const NOW = new Date('2026-08-06T09:00:00').getTime();

const MINUTE = 60_000;

/** An agenda item for a task, defaulting to one due exactly now. */
function task(overrides: Partial<AgendaItem> & { id?: string } = {}): AgendaItem {
  const id = overrides.id ?? 't1';
  const start = overrides.start ?? NOW;
  return {
    key: `task:${id}`,
    source: 'task',
    id,
    title: 'Water the plants',
    start,
    end: start,
    allDay: false,
    done: false,
    ...overrides,
  };
}

/** An agenda item for a calendar event, due now. */
function event(overrides: Partial<AgendaItem> = {}): AgendaItem {
  return {
    ...task(),
    key: 'event:primary:e1',
    source: 'event',
    id: 'e1',
    title: 'Standup',
    ...overrides,
  };
}

/** The titles of whatever is owed, for terser assertions. */
function pendingTitles(items: AgendaItem[], at = NOW, sent: string[] = []): string[] {
  return pendingNotices(items, at, sent).map((notice) => notice.title);
}

describe('noticeKey', () => {
  it('pairs the item with the due time it fired for', () => {
    expect(noticeKey(task({ start: NOW }))).toBe(`task:t1@${NOW}`);
  });

  it('changes when the task is rescheduled, so the new time can fire too', () => {
    const beforeReschedule = noticeKey(task({ start: NOW }));
    const afterReschedule = noticeKey(task({ start: NOW + 60 * MINUTE }));

    expect(afterReschedule).not.toBe(beforeReschedule);
  });
});

describe('noticeBody', () => {
  it('reads as "Due now" for a task that has just come due', () => {
    expect(noticeBody(task(), NOW)).toBe('Due now');
    expect(noticeBody(task(), NOW + 59_000)).toBe('Due now');
  });

  it('says how late a delayed notice is', () => {
    expect(noticeBody(task(), NOW + 5 * MINUTE)).toBe('Due 5m ago');
    expect(noticeBody(task(), NOW + 29 * MINUTE)).toBe('Due 29m ago');
  });
});

describe('pendingNotices', () => {
  it('raises a task the moment its due time arrives', () => {
    expect(pendingTitles([task()])).toEqual(['Water the plants']);
  });

  it('raises nothing for a task that is not due yet', () => {
    expect(pendingTitles([task({ start: NOW + MINUTE })])).toEqual([]);
  });

  it('catches up on a task that came due while the tab slept', () => {
    expect(pendingTitles([task({ start: NOW - 20 * MINUTE })])).toEqual(['Water the plants']);
  });

  it('raises nothing for a task overdue by longer than the grace period', () => {
    expect(pendingTitles([task({ start: NOW - GRACE_MS - MINUTE })])).toEqual([]);
  });

  it('raises nothing for a task already ticked off', () => {
    expect(pendingTitles([task({ done: true })])).toEqual([]);
  });

  it('raises nothing for a calendar event, which Google alerts on already', () => {
    expect(pendingTitles([event()])).toEqual([]);
  });

  it('does not raise the same due time twice', () => {
    const items = [task()];

    const firstRun = pendingNotices(items, NOW, []);

    expect(firstRun).toHaveLength(1);
    expect(pendingNotices(items, NOW + MINUTE, [firstRun[0].key])).toEqual([]);
  });

  it('raises a task again once it is moved to a new time', () => {
    const alreadySent = [noticeKey(task({ start: NOW - 10 * MINUTE }))];

    expect(pendingTitles([task({ start: NOW })], NOW, alreadySent)).toEqual(['Water the plants']);
  });

  it('raises everything that came due together, in agenda order', () => {
    const items = [
      task({ id: 'a', title: 'Earlier', start: NOW - 10 * MINUTE }),
      task({ id: 'b', title: 'Later', start: NOW - MINUTE }),
    ];

    expect(pendingTitles(items)).toEqual(['Earlier', 'Later']);
  });

  it('carries how late each one is', () => {
    const items = [task({ id: 'a', start: NOW - 3 * MINUTE }), task({ id: 'b', start: NOW })];

    const bodies = pendingNotices(items, NOW, []).map((notice) => notice.body);

    expect(bodies).toEqual(['Due 3m ago', 'Due now']);
  });

  it('gives an untitled task something to say', () => {
    expect(pendingTitles([task({ title: '   ' })])).toEqual(['Task due']);
  });
});

describe('pruneSent', () => {
  it('keeps entries that could still match a live task', () => {
    const key = `task:t1@${NOW - MINUTE}`;

    expect(pruneSent([key], NOW)).toEqual([key]);
  });

  it('drops entries too old to ever fire again', () => {
    expect(pruneSent([`task:t1@${NOW - GRACE_MS - MINUTE}`], NOW)).toEqual([]);
  });

  it('drops malformed entries rather than carrying them forever', () => {
    expect(pruneSent(['task:t1', '', 'task:t1@nonsense'], NOW)).toEqual([]);
  });

  it('leaves an already-clean ledger alone', () => {
    const keys = [`task:a@${NOW}`, `task:b@${NOW - 5 * MINUTE}`];

    expect(pruneSent(keys, NOW)).toEqual(keys);
  });
});
