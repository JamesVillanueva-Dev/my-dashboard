import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MorningBriefWidget from './index';
// Module class names are hashed at build time, so the load marker is asserted
// through the stylesheet rather than as a literal string.
import styles from './styles.module.css';
import { DashboardDataProvider } from '../../hooks/DashboardDataProvider';
import { clearCache } from '../../lib/cache';
import type { CalendarEvent } from '../../lib/gcalEvents';
import type { MailSummary } from '../../lib/gmail';
import { FLOOR, type RankedMail } from '../../lib/importantMail';

const { google } = vi.hoisted(() => ({
  google: {
    configured: true,
    fetchUpcoming: vi.fn(),
    fetchInbox: vi.fn(),
    fetchProfileEmail: vi.fn(),
    fetchKnownSenders: vi.fn(),
    rankMail: vi.fn(),
  },
}));

vi.mock('../../lib/googleAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/googleAuth')>()),
  hasGoogleClientId: () => google.configured,
}));
vi.mock('../../lib/gcalEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/gcalEvents')>()),
  fetchUpcoming: (...args: unknown[]) => google.fetchUpcoming(...args),
}));
vi.mock('../../lib/gmail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/gmail')>()),
  fetchInbox: (interactive: boolean) => google.fetchInbox(interactive),
  fetchProfileEmail: () => google.fetchProfileEmail(),
  fetchKnownSenders: (messages: MailSummary[]) => google.fetchKnownSenders(messages),
}));
vi.mock('../../lib/importantMail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/importantMail')>()),
  rankMail: (...args: unknown[]) => google.rankMail(...args),
}));

/** The fixture day, pinned so nothing here drifts with the wall clock. */
const DAY = new Date(2026, 0, 15);

/** Epoch ms for a local time on the fixture day. */
function at(hour: number, minute = 0): number {
  return new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate(), hour, minute).getTime();
}

/** A timed calendar event on the fixture day. */
function event(title: string, startHour: number, minutes: number): CalendarEvent {
  return {
    id: title,
    calendarId: 'primary',
    title,
    start: at(startHour),
    end: at(startHour) + minutes * 60_000,
    allDay: false,
  };
}

/** A ranked message, above the ranking's floor. */
function pick(id: string, subject: string, reason: string): RankedMail {
  return {
    message: {
      id,
      from: `Priya <${id}@example.com>`,
      subject,
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
    },
    reason,
    score: 40,
    merit: FLOOR + 10,
    signals: [],
  };
}

/** Marks the calendar as already connected, as a returning user's would be. */
function seedCalendar(events: CalendarEvent[]) {
  window.localStorage.setItem('gcal.view.connected', JSON.stringify(true));
  window.localStorage.setItem('tasks.mergedTodos', 'true');
  google.fetchUpcoming.mockResolvedValue(events);
}

/** Marks Gmail as connected and pins what the ranking returns. */
function seedMail(ranking: RankedMail[]) {
  window.localStorage.setItem('mail.connected', JSON.stringify(true));
  google.rankMail.mockReturnValue(ranking);
}

function renderPanel() {
  return render(
    <DashboardDataProvider>
      <MorningBriefWidget />
    </DashboardDataProvider>,
  );
}

/** The card element, which is where the load class lands. */
const card = (container: HTMLElement) => container.querySelector('section')!;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 0, 15, 8, 0, 0));
  window.localStorage.clear();
  clearCache();
  google.configured = true;
  google.fetchUpcoming.mockReset().mockResolvedValue([]);
  google.fetchInbox.mockReset().mockResolvedValue([]);
  google.fetchProfileEmail.mockReset().mockResolvedValue('you@example.com');
  google.fetchKnownSenders.mockReset().mockResolvedValue(new Set());
  google.rankMail.mockReset().mockReturnValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MorningBriefWidget on a heavy day', () => {
  const heavy = [
    event('Standup', 9, 30),
    event('Design review', 10, 90),
    event('1:1 with Priya', 13, 60),
    event('Planning', 14, 120),
  ];

  it('names the day and how much of it is spoken for', async () => {
    seedCalendar(heavy);

    renderPanel();

    expect(
      await screen.findByText('Today is a heavy one — 4 commitments, about 5 hours of it spoken for.'),
    ).toBeInTheDocument();
  });

  it('marks the card as heavy, so the accent can follow the classification', async () => {
    seedCalendar(heavy);

    const { container } = renderPanel();

    await screen.findByText(/heavy one/);
    expect(card(container)).toHaveClass(styles.isHeavy);
  });

  it('describes the shape of the day under the headline', async () => {
    seedCalendar(heavy);

    renderPanel();

    await screen.findByText(/heavy one/);
    expect(screen.getByText(/^It starts with Standup at/)).toBeInTheDocument();
    expect(screen.getByText(/^The longest clear stretch is 1½ hours/)).toBeInTheDocument();
    expect(screen.getByText(/^It’s all done by/)).toBeInTheDocument();
  });
});

describe('MorningBriefWidget on an open day', () => {
  it('counts the little there is without dressing the space up', async () => {
    seedCalendar([event('Coffee with Sam', 11, 45)]);

    const { container } = renderPanel();

    expect(
      await screen.findByText('A quiet day — 1 commitment, and the rest of it is yours.'),
    ).toBeInTheDocument();
    expect(card(container)).toHaveClass(styles.isOpen);
    // One commitment has no stretch *between* commitments, and "it's all done
    // by 11:45" already says the rest of the day is free.
    expect(screen.queryByText(/longest clear stretch/)).not.toBeInTheDocument();
  });

  it('calls an empty calendar wide open when there is still mail to point at', async () => {
    seedCalendar([]);
    seedMail([pick('m1', 'Lease renewal', 'Gmail flags it important')]);

    const { container } = renderPanel();

    expect(
      await screen.findByText('Today is wide open — nothing on the calendar.'),
    ).toBeInTheDocument();
    expect(card(container)).toHaveClass(styles.isOpen);
  });

  it('still points at the mail that needs a reply', async () => {
    seedCalendar([]);
    seedMail([pick('m1', 'Lease renewal', 'Makes a direct request, addressed to you alone')]);

    renderPanel();

    const picks = within(await screen.findByRole('list', { name: 'Worth a reply' }));
    expect(picks.getByRole('link', { name: 'Lease renewal' })).toBeInTheDocument();
    expect(picks.getByText('Makes a direct request, addressed to you alone')).toBeInTheDocument();
  });

  it('reuses the ranking’s reason rather than writing a second explanation', async () => {
    seedCalendar([]);
    seedMail([pick('m1', 'Lease renewal', 'Gmail flags it important')]);

    renderPanel();

    await screen.findByRole('link', { name: 'Lease renewal' });
    expect(google.rankMail).toHaveBeenCalled();
    expect(screen.getByText('Gmail flags it important')).toBeInTheDocument();
  });
});

describe('MorningBriefWidget with nothing to report', () => {
  it('says one calm line and stops', async () => {
    seedCalendar([]);
    seedMail([]);

    renderPanel();

    expect(
      await screen.findByText(
        'Nothing on the calendar, and nothing in your mail that needs you. Take the day as it comes.',
      ),
    ).toBeInTheDocument();
    // No shape, no picks, no apology about either.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/Worth a reply/)).not.toBeInTheDocument();
  });

  it('claims nothing about mail it was never allowed to read', async () => {
    seedCalendar([]);

    renderPanel();

    expect(
      await screen.findByText('Nothing on the calendar today. Take it as it comes.'),
    ).toBeInTheDocument();
    expect(google.fetchInbox).not.toHaveBeenCalled();
  });
});

describe('MorningBriefWidget without a calendar', () => {
  it('declines to describe a day it cannot see', async () => {
    // Configured but never connected: the agenda is empty because nothing was
    // read, not because the day is clear.
    renderPanel();

    expect(
      await screen.findByText(/calendar isn’t connected yet/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/wide open/)).not.toBeInTheDocument();
  });

  it('describes the day normally once there is no Google to connect to', async () => {
    // Unconfigured is a different state: there is no calendar feature at all, so
    // the panel works from what it has rather than pointing at a missing setup.
    google.configured = false;

    renderPanel();

    expect(await screen.findByText(/Nothing on the calendar today/)).toBeInTheDocument();
  });
});

describe('MorningBriefWidget when the inbox cannot be read', () => {
  it('says the read failed rather than passing silence off as an empty inbox', async () => {
    seedCalendar([event('Standup', 9, 30)]);
    window.localStorage.setItem('mail.connected', JSON.stringify(true));
    google.fetchInbox.mockRejectedValue(new Error('session expired'));

    renderPanel();

    expect(await screen.findByText(/Couldn’t read your mail this morning/)).toBeInTheDocument();
    // The calendar half is unaffected — half a brief beats none.
    expect(screen.getByText(/A quiet day/)).toBeInTheDocument();
  });

  it('offers a retry that reads the inbox again', async () => {
    seedCalendar([]);
    window.localStorage.setItem('mail.connected', JSON.stringify(true));
    google.fetchInbox.mockRejectedValue(new Error('session expired'));
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(/Couldn’t read your mail/);

    google.fetchInbox.mockResolvedValue([]);
    google.rankMail.mockReturnValue([pick('m1', 'Lease renewal', 'Gmail flags it important')]);
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('link', { name: 'Lease renewal' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText(/Couldn’t read your mail/)).not.toBeInTheDocument(),
    );
  });
});

describe('MorningBriefWidget headline', () => {
  it('carries no emoji', async () => {
    seedCalendar([event('Standup', 9, 30)]);

    renderPanel();

    const line = await screen.findByText(/A quiet day/);
    expect(line.textContent).toMatch(/^[\p{L}\p{N}\p{P}\p{Zs}½]+$/u);
  });
});
