import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CalendarWidget from './index';
import styles from './styles.module.css';
import { DashboardDataProvider } from '../../hooks/DashboardDataProvider';

/** Calendar events come from the shared provider now, so tests supply one. */
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: DashboardDataProvider });

// The widget's Google path is gated on a configured client id, which the test
// env forces off (see vite.config.ts). Mock the auth module so the connected
// path is reachable without touching Google Identity Services.
const getAccessToken = vi.fn<(interactive: boolean) => Promise<string>>(() =>
  Promise.resolve('test-token'),
);
vi.mock('../../lib/googleAuth', () => ({
  hasGoogleClientId: () => configured,
  getAccessToken: (interactive: boolean) => getAccessToken(interactive),
  clearAccessToken: vi.fn(),
}));

let configured = true;

/** `getAccessToken`'s argument: whether a consent popup is allowed. */
const INTERACTIVE = true;

/** Builds a fetch stub that answers calendarList then per-calendar events. */
function stubCalendar(events: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const body = url.includes('/users/me/calendarList')
        ? { items: [{ id: 'primary', summary: 'Me', primary: true }] }
        : { items: events };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }),
  );
}

/** An ISO string `hours` from now, for events anchored to the test's clock. */
function inHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

/** Today, as an all-day event's `date` field. */
function todayDate(): string {
  const today = new Date();
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

/** Renders the widget and clicks through the connect prompt. */
async function renderConnected(user: ReturnType<typeof userEvent.setup>) {
  render(<CalendarWidget />);
  await user.click(screen.getByRole('button', { name: 'Connect Google' }));
}

/** The current fetch stub, for counting requests. */
const fetchMock = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  configured = true;
  getAccessToken.mockClear();
});

describe('CalendarWidget before connecting', () => {
  it('renders the setup hint when unconfigured', () => {
    configured = false;
    vi.stubGlobal('fetch', vi.fn());

    render(<CalendarWidget />);

    expect(screen.getByText(/VITE_GOOGLE_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Google/ })).not.toBeInTheDocument();
  });

  it('makes no network calls when unconfigured', () => {
    configured = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(<CalendarWidget />);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows a connect prompt', () => {
    stubCalendar([]);

    render(<CalendarWidget />);

    expect(screen.getByRole('button', { name: 'Connect Google' })).toBeInTheDocument();
    expect(screen.getByText(/what’s coming up/i)).toBeInTheDocument();
  });

  it('requests a token interactively only when the user clicks connect', async () => {
    stubCalendar([]);
    const user = userEvent.setup();

    await renderConnected(user);
    await screen.findByText(/Nothing scheduled/);

    expect(getAccessToken).toHaveBeenCalledWith(INTERACTIVE);
  });
});

describe('CalendarWidget agenda', () => {
  it('groups events under the day they fall on', async () => {
    stubCalendar([
      {
        id: 'timed',
        summary: 'Standup',
        start: { dateTime: inHours(2) },
        end: { dateTime: inHours(3) },
      },
    ]);
    const user = userEvent.setup();

    await renderConnected(user);

    expect(await screen.findByText('Standup')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('pins all-day events above timed ones within a day', async () => {
    stubCalendar([
      {
        id: 'timed',
        summary: 'Standup',
        start: { dateTime: inHours(2) },
        end: { dateTime: inHours(3) },
      },
      {
        id: 'allday',
        summary: 'Conference',
        start: { date: todayDate() },
        end: { date: todayDate() },
      },
    ]);
    const user = userEvent.setup();

    await renderConnected(user);
    await screen.findByText('Conference');

    // Regardless of the order Google returned them in.
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent);
    expect(rows[0]).toContain('Conference');
    expect(rows[1]).toContain('Standup');
    expect(screen.getByText('All day')).toBeInTheDocument();
  });

  it('marks an in-progress event as Now', async () => {
    stubCalendar([
      {
        id: 'live',
        summary: 'Lecture',
        start: { dateTime: inHours(-0.5) },
        end: { dateTime: inHours(0.5) },
      },
    ]);
    const user = userEvent.setup();

    await renderConnected(user);

    expect(await screen.findByText('Now')).toHaveClass(styles.isNow);
  });

  it('hides declined and cancelled events', async () => {
    stubCalendar([
      {
        id: 'declined',
        summary: 'Optional sync',
        start: { dateTime: inHours(4) },
        end: { dateTime: inHours(5) },
        attendees: [{ self: true, responseStatus: 'declined' }],
      },
      {
        id: 'cancelled',
        summary: 'Scrapped meeting',
        status: 'cancelled',
        start: { dateTime: inHours(6) },
        end: { dateTime: inHours(7) },
      },
      {
        id: 'kept',
        summary: 'Office hours',
        start: { dateTime: inHours(8) },
        end: { dateTime: inHours(9) },
      },
    ]);
    const user = userEvent.setup();

    await renderConnected(user);

    expect(await screen.findByText('Office hours')).toBeInTheDocument();
    expect(screen.queryByText('Optional sync')).not.toBeInTheDocument();
    expect(screen.queryByText('Scrapped meeting')).not.toBeInTheDocument();
  });

  it('shows an empty state when the window holds no events', async () => {
    stubCalendar([]);
    const user = userEvent.setup();

    await renderConnected(user);

    expect(await screen.findByText(/Nothing scheduled in the next/)).toBeInTheDocument();
  });

  it('surfaces an error with a retry when the API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) })),
    );
    const user = userEvent.setup();

    await renderConnected(user);

    expect(await screen.findByText(/Couldn’t load your calendar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('CalendarWidget month view', () => {
  it('is not offered before connecting', () => {
    stubCalendar([]);

    render(<CalendarWidget />);

    expect(screen.queryByRole('button', { name: 'Open full calendar' })).not.toBeInTheDocument();
  });

  it('is offered once connected', async () => {
    stubCalendar([]);
    const user = userEvent.setup();

    await renderConnected(user);

    expect(await screen.findByRole('button', { name: 'Open full calendar' })).toBeInTheDocument();
  });

  it('fetches a month only once it is opened', async () => {
    stubCalendar([]);
    const user = userEvent.setup();
    await renderConnected(user);
    await screen.findByText(/Nothing scheduled/);
    const requestsBeforeOpen = fetchMock().mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Open full calendar' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(fetchMock().mock.calls.length).toBeGreaterThan(requestsBeforeOpen);
  });

  it('returns focus to the trigger when it closes', async () => {
    stubCalendar([]);
    const user = userEvent.setup();
    await renderConnected(user);
    const trigger = await screen.findByRole('button', { name: 'Open full calendar' });
    await user.click(trigger);
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Close calendar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
