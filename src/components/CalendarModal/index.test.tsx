import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CalendarModal from './index';
import styles from './styles.module.css';

// Same shape as the CalendarWidget suite: the test env forces the client id off,
// so mock the auth module to reach the connected path without touching GIS.
vi.mock('../../lib/googleAuth', () => ({
  hasGoogleClientId: () => true,
  getAccessToken: () => Promise.resolve('test-token'),
  clearAccessToken: vi.fn(),
}));

/** Noon on Monday 3 August 2026, in whatever timezone the runner uses. */
const NOW = new Date(2026, 7, 3, 12).getTime();

/** An ISO instant from local calendar fields, so fixtures land on the right day. */
function at(year: number, month: number, day: number, hour = 0): string {
  return new Date(year, month, day, hour).toISOString();
}

interface RawEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
  htmlLink?: string;
}

function timed(id: string, day: number, from: number, to: number, month = 7): RawEvent {
  return {
    id,
    summary: id,
    start: { dateTime: at(2026, month, day, from) },
    end: { dateTime: at(2026, month, day, to) },
  };
}

/** `endExclusive` mirrors Google: the day *after* the last day of the event. */
function allDay(id: string, day: number, endExclusive: number, month = 7): RawEvent {
  const iso = (d: number) => `2026-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { id, summary: id, start: { date: iso(day) }, end: { date: iso(endExclusive) } };
}

/** Requests held open by {@link stub}, released with {@link flushSlow}. */
let held: (() => void)[] = [];
/** Every events URL requested, in order. */
let requested: string[] = [];
/** Every non-GET request, in order. */
let writes: { method: string; url: string; body: Record<string, unknown> | undefined }[] = [];

/** Knobs for {@link stub}. */
interface StubOptions {
  /** Months whose response is withheld until {@link flushSlow}. */
  slow?: string[];
  /** `accessRole` reported for the calendar; 'reader' makes it read-only. */
  accessRole?: string;
  /** HTTP status to fail writes with, instead of succeeding. */
  writeStatus?: number;
}

/**
 * Answers `calendarList` then per-calendar events, choosing the response by
 * which month the request's window is centred on, and records any writes.
 *
 * @param byMonth - `YYYY-MM` → the events that month's request returns.
 * @param opts - See {@link StubOptions}.
 */
function stub(byMonth: Record<string, RawEvent[]>, opts: StubOptions = {}) {
  const { slow = [], accessRole = 'owner', writeStatus } = opts;
  const ok = (body: unknown, status = 200) => ({ ok: true, status, json: () => Promise.resolve(body) });

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        writes.push({
          method,
          url,
          body: init?.body ? JSON.parse(init.body as string) : undefined,
        });
        if (writeStatus) {
          return Promise.resolve({ ok: false, status: writeStatus, json: () => Promise.resolve({}) });
        }
        return Promise.resolve(ok({ id: 'created' }, method === 'DELETE' ? 204 : 200));
      }

      if (url.includes('/users/me/calendarList')) {
        return Promise.resolve(
          ok({
            items: [
              {
                id: 'primary',
                summary: 'Personal',
                backgroundColor: '#2f6bff',
                primary: true,
                accessRole,
              },
            ],
          }),
        );
      }
      requested.push(url);

      // The window starts on the grid's first cell, up to six days before the
      // month itself; ten days in is always inside the visible month.
      const timeMin = new Date(new URL(url).searchParams.get('timeMin') as string);
      const probe = new Date(timeMin.getTime());
      probe.setDate(probe.getDate() + 10);
      const key = `${probe.getFullYear()}-${String(probe.getMonth() + 1).padStart(2, '0')}`;

      const body = { items: byMonth[key] ?? [] };
      if (slow.includes(key)) {
        return new Promise((resolve) => held.push(() => resolve(ok(body))));
      }
      return Promise.resolve(ok(body));
    }),
  );
}

/** Releases every withheld response and lets React settle. */
async function flushSlow() {
  await act(async () => {
    held.forEach((release) => release());
    held = [];
  });
}

/** The month grid's day buttons, by accessible name fragment. */
function dayCell(name: RegExp | string) {
  return screen.getByRole('button', { name });
}

const AUGUST: RawEvent[] = [
  timed('Standup', 3, 9, 10),
  allDay('Conference', 3, 6),
  { ...timed('Dentist', 5, 14, 15), location: 'Clinic', htmlLink: 'https://cal.example/dentist' },
];

function open(now = NOW) {
  const onClose = vi.fn();
  const view = render(<CalendarModal now={now} onClose={onClose} />);
  return { onClose, ...view };
}

describe('CalendarModal', () => {
  beforeEach(() => {
    held = [];
    requested = [];
    writes = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens on the current month with today selected', async () => {
    stub({ '2026-08': AUGUST });
    open();

    expect(await screen.findByRole('heading', { name: 'August 2026' })).toBeInTheDocument();

    const today = dayCell(/Monday, August 3, 2026/);
    expect(today).toHaveClass(styles.isToday);
    expect(today).toHaveClass(styles.isSelected);
    expect(today).toHaveAttribute('aria-current', 'date');

    // The detail panel defaults to today.
    expect(screen.getByRole('heading', { name: 'Monday, August 3' })).toBeInTheDocument();
  });

  it('fills the first and last weeks with the neighbouring months', async () => {
    stub({ '2026-08': AUGUST });
    open();
    await screen.findByRole('heading', { name: 'August 2026' });

    // 1 Aug 2026 is a Saturday, so the grid runs 26 Jul – 5 Sep.
    expect(dayCell(/Sunday, July 26, 2026/)).toHaveClass(styles.isOutsideMonth);
    expect(dayCell(/Saturday, September 5, 2026/)).toHaveClass(styles.isOutsideMonth);
    expect(dayCell(/Monday, August 3, 2026/)).not.toHaveClass(styles.isOutsideMonth);
  });

  it('repeats a multi-day all-day event across each day it covers', async () => {
    stub({ '2026-08': AUGUST });
    open();

    // Conference runs 3–5 August (Google reports the end as the 6th).
    expect(await screen.findByRole('button', { name: /August 3, 2026, 2 events/ })).toBeInTheDocument();
    expect(dayCell(/August 4, 2026, 1 event/)).toBeInTheDocument();
    expect(dayCell(/August 5, 2026, 2 events/)).toBeInTheDocument();
    expect(dayCell(/August 6, 2026, no events/)).toBeInTheDocument();
  });

  it('shows a day’s events in the detail panel when it is clicked', async () => {
    stub({ '2026-08': AUGUST });
    const user = userEvent.setup();
    open();
    await screen.findByRole('heading', { name: 'August 2026' });

    await user.click(dayCell(/Wednesday, August 5, 2026/));

    expect(screen.getByRole('heading', { name: 'Wednesday, August 5' })).toBeInTheDocument();
    const panel = screen.getByRole('list');
    expect(within(panel).getByText('Dentist')).toBeInTheDocument();
    expect(within(panel).getByText('Clinic')).toBeInTheDocument();
    // The all-day event still covers the 5th.
    expect(within(panel).getByText('Conference')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Dentist' })).toHaveAttribute(
      'href',
      'https://cal.example/dentist',
    );
  });

  it('collapses a busy day into "+N more"', async () => {
    stub({
      '2026-08': [
        timed('One', 12, 9, 10),
        timed('Two', 12, 11, 12),
        timed('Three', 12, 13, 14),
        timed('Four', 12, 15, 16),
        timed('Five', 12, 17, 18),
      ],
    });
    open();

    const busy = await screen.findByRole('button', { name: /August 12, 2026, 5 events/ });
    expect(within(busy).getByText('+2 more')).toBeInTheDocument();
  });

  it('pages months and fetches the new window', async () => {
    stub({ '2026-08': AUGUST, '2026-09': [timed('Retreat', 10, 9, 17, 8)] });
    const user = userEvent.setup();
    open();
    await screen.findByRole('heading', { name: 'August 2026' });

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
    expect(dayCell(/September 10, 2026, 1 event/)).toBeInTheDocument();
    // Selection follows into the new month rather than pointing off-screen.
    expect(screen.getByRole('heading', { name: 'Tuesday, September 1' })).toBeInTheDocument();

    // September's grid opens on 30 August.
    const timeMin = new URL(requested[requested.length - 1]).searchParams.get('timeMin') as string;
    expect(new Date(timeMin).getDate()).toBe(30);

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(await screen.findByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
  });

  it('returns to the current month from Today', async () => {
    stub({ '2026-08': AUGUST, '2026-09': [] });
    const user = userEvent.setup();
    open();
    await screen.findByRole('heading', { name: 'August 2026' });

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await screen.findByRole('heading', { name: 'September 2026' });

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
    expect(dayCell(/Monday, August 3, 2026/)).toHaveClass(styles.isSelected);
  });

  it('serves a month from cache instead of re-fetching it', async () => {
    stub({ '2026-08': AUGUST, '2026-09': [] });
    const user = userEvent.setup();
    open();
    await screen.findByRole('heading', { name: 'August 2026' });
    const afterFirstLoad = requested.length;

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await screen.findByRole('heading', { name: 'September 2026' });
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await screen.findByRole('heading', { name: 'August 2026' });

    // September cost one request; coming back to August cost none.
    expect(requested).toHaveLength(afterFirstLoad + 1);
    expect(screen.getByRole('button', { name: /August 3, 2026, 2 events/ })).toBeInTheDocument();
  });

  it('ignores a stale month’s response that lands after a newer one', async () => {
    stub(
      {
        '2026-08': AUGUST,
        '2026-09': [timed('Stale September', 10, 9, 10, 8)],
        '2026-10': [timed('Fresh October', 8, 9, 10, 9)],
      },
      { slow: ['2026-09'] },
    );
    const user = userEvent.setup();
    open();
    await screen.findByRole('heading', { name: 'August 2026' });

    // September's response is withheld; October's resolves straight away.
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    expect(dayCell(/October 8, 2026, 1 event/)).toBeInTheDocument();

    // September lands last and must not paint over October.
    await flushSlow();
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    expect(dayCell(/October 8, 2026, 1 event/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /September 10, 2026, 1 event/ })).toBeNull();
  });

  it('surfaces an error with a working retry', async () => {
    const failing = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
    );
    vi.stubGlobal('fetch', failing);
    const user = userEvent.setup();
    open();

    expect(await screen.findByText(/Couldn’t load your calendar/)).toBeInTheDocument();

    const callsBeforeRetry = failing.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(failing.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
  });

  it('moves the grid focus with the arrow keys and selects with Enter', async () => {
    stub({ '2026-08': AUGUST });
    const user = userEvent.setup();
    open();
    await screen.findByRole('heading', { name: 'August 2026' });

    await user.click(dayCell(/Monday, August 3, 2026/));
    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(dayCell(/Tuesday, August 11, 2026/)).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Tuesday, August 11' })).toBeInTheDocument();
  });

  it('pages the month when the arrow keys walk off the grid', async () => {
    stub({ '2026-08': AUGUST, '2026-07': [] });
    const user = userEvent.setup();
    open();
    await screen.findByRole('heading', { name: 'August 2026' });

    // 26 July is the first cell; one more step left leaves the grid.
    await user.click(dayCell(/Sunday, July 26, 2026/));
    await user.keyboard('{ArrowLeft}');

    expect(await screen.findByRole('heading', { name: 'July 2026' })).toBeInTheDocument();
    expect(dayCell(/Saturday, July 25, 2026/)).toHaveFocus();
  });

  it('keeps a single tab stop across the whole grid', async () => {
    stub({ '2026-08': AUGUST });
    open();
    await screen.findByRole('heading', { name: 'August 2026' });

    const tabbable = screen
      .getAllByRole('button')
      .filter((b) => b.className.includes(styles.day) && b.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName(/Monday, August 3, 2026/);
  });

  it('creates an event on the selected day', async () => {
    stub({ '2026-08': AUGUST });
    const user = userEvent.setup();
    open();
    await screen.findByRole('heading', { name: 'August 2026' });

    await user.click(screen.getByRole('button', { name: '+ Add event' }));
    await user.type(screen.getByLabelText('Title'), 'Retro');
    const beforeSave = requested.length;
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // The form closes back to the day list once the write lands.
    expect(await screen.findByRole('button', { name: '+ Add event' })).toBeInTheDocument();

    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('POST');
    expect(writes[0].url).toContain('/calendars/primary/events');
    expect(writes[0].body).toMatchObject({
      summary: 'Retro',
      // Today is selected, and a new event defaults to the next whole hour.
      start: { dateTime: new Date(2026, 7, 3, 13).toISOString() },
      end: { dateTime: new Date(2026, 7, 3, 14).toISOString() },
    });
    // And the month is re-read, so the new event shows up.
    expect(requested.length).toBeGreaterThan(beforeSave);
  });

  it('edits an existing event', async () => {
    stub({ '2026-08': AUGUST });
    const user = userEvent.setup();
    open();
    await screen.findByRole('heading', { name: 'August 2026' });

    await user.click(dayCell(/Wednesday, August 5, 2026/));
    await user.click(screen.getByRole('button', { name: 'Edit Dentist' }));

    expect(screen.getByLabelText('Title')).toHaveValue('Dentist');
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Dentist — moved');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('button', { name: '+ Add event' });
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('PATCH');
    expect(writes[0].url).toContain('/calendars/primary/events/Dentist');
    expect(writes[0].body).toMatchObject({ summary: 'Dentist — moved' });
  });

  it('deletes an event only after the confirm step', async () => {
    stub({ '2026-08': AUGUST });
    const user = userEvent.setup();
    open();
    await screen.findByRole('heading', { name: 'August 2026' });

    await user.click(dayCell(/Wednesday, August 5, 2026/));
    await user.click(screen.getByRole('button', { name: 'Edit Dentist' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(writes).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await screen.findByRole('button', { name: '+ Add event' });
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('DELETE');
    expect(writes[0].url).toContain('/calendars/primary/events/Dentist');
  });

  it('keeps the form open with the typed values when a save fails', async () => {
    stub({ '2026-08': AUGUST }, { writeStatus: 403 });
    const user = userEvent.setup();
    open();
    await screen.findByRole('heading', { name: 'August 2026' });

    await user.click(screen.getByRole('button', { name: '+ Add event' }));
    await user.type(screen.getByLabelText('Title'), 'Retro');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/permission/i);
    expect(screen.getByLabelText('Title')).toHaveValue('Retro');
  });

  it('rejects an untitled event before reaching the network', async () => {
    stub({ '2026-08': AUGUST });
    const user = userEvent.setup();
    open();
    await screen.findByRole('heading', { name: 'August 2026' });

    await user.click(screen.getByRole('button', { name: '+ Add event' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/title/i);
    expect(writes).toHaveLength(0);
  });

  it('dismisses an open form when another day is selected', async () => {
    stub({ '2026-08': AUGUST });
    const user = userEvent.setup();
    open();
    await screen.findByRole('heading', { name: 'August 2026' });

    await user.click(screen.getByRole('button', { name: '+ Add event' }));
    expect(screen.getByLabelText('Title')).toBeInTheDocument();

    await user.click(dayCell(/Wednesday, August 5, 2026/));

    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wednesday, August 5' })).toBeInTheDocument();
  });

  it('offers no editing for a calendar the user can only read', async () => {
    stub({ '2026-08': AUGUST }, { accessRole: 'reader' });
    const user = userEvent.setup();
    open();
    await screen.findByRole('heading', { name: 'August 2026' });

    expect(screen.queryByRole('button', { name: '+ Add event' })).not.toBeInTheDocument();

    await user.click(dayCell(/Wednesday, August 5, 2026/));
    const panel = screen.getByRole('list');
    expect(within(panel).getByText('Dentist')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Edit Dentist' })).not.toBeInTheDocument();
  });

  it('closes on Escape and on a backdrop click', async () => {
    stub({ '2026-08': AUGUST });
    const user = userEvent.setup();
    const { onClose } = open();
    await screen.findByRole('heading', { name: 'August 2026' });

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not close when the dialog itself is clicked', async () => {
    stub({ '2026-08': AUGUST });
    const user = userEvent.setup();
    const { onClose } = open();
    await screen.findByRole('heading', { name: 'August 2026' });

    await user.click(screen.getByRole('heading', { name: 'August 2026' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
