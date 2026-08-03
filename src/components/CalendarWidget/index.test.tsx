import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CalendarWidget from './index';
import styles from './styles.module.css';

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

describe('CalendarWidget', () => {
  beforeEach(() => {
    configured = true;
    getAccessToken.mockClear();
  });

  it('renders the setup hint and makes no network calls when unconfigured', () => {
    configured = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(<CalendarWidget />);

    expect(screen.getByText(/VITE_GOOGLE_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Google/ })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows a connect prompt before the user connects', () => {
    stubCalendar([]);
    render(<CalendarWidget />);

    expect(screen.getByRole('button', { name: 'Connect Google' })).toBeInTheDocument();
    expect(screen.getByText(/what’s coming up/i)).toBeInTheDocument();
  });

  it('groups events by day and pins all-day events above timed ones', async () => {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const todayDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

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
        start: { date: todayDate },
        end: { date: todayDate },
      },
    ]);
    const user = userEvent.setup();
    render(<CalendarWidget />);
    await user.click(screen.getByRole('button', { name: 'Connect Google' }));

    expect(await screen.findByText('Conference')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();

    // All-day first within the day, regardless of the order Google returned.
    const titles = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(titles[0]).toContain('Conference');
    expect(titles[1]).toContain('Standup');
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
    render(<CalendarWidget />);
    await user.click(screen.getByRole('button', { name: 'Connect Google' }));

    const now = await screen.findByText('Now');
    expect(now).toHaveClass(styles.isNow);
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
    render(<CalendarWidget />);
    await user.click(screen.getByRole('button', { name: 'Connect Google' }));

    expect(await screen.findByText('Office hours')).toBeInTheDocument();
    expect(screen.queryByText('Optional sync')).not.toBeInTheDocument();
    expect(screen.queryByText('Scrapped meeting')).not.toBeInTheDocument();
  });

  it('shows an empty state when the window holds no events', async () => {
    stubCalendar([]);
    const user = userEvent.setup();
    render(<CalendarWidget />);
    await user.click(screen.getByRole('button', { name: 'Connect Google' }));

    expect(await screen.findByText(/Nothing scheduled in the next/)).toBeInTheDocument();
  });

  it('surfaces an error with a retry when the API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) })),
    );
    const user = userEvent.setup();
    render(<CalendarWidget />);
    await user.click(screen.getByRole('button', { name: 'Connect Google' }));

    expect(await screen.findByText(/Couldn’t load your calendar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('requests interactively only when the user clicks connect', async () => {
    stubCalendar([]);
    const user = userEvent.setup();
    render(<CalendarWidget />);
    await user.click(screen.getByRole('button', { name: 'Connect Google' }));
    await screen.findByText(/Nothing scheduled/);

    expect(getAccessToken).toHaveBeenCalledWith(true);
  });
});
