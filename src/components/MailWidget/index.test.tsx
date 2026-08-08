import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MailWidget from './index';
import type { MailSummary } from '../../lib/gmail';
import type { RankedMail } from '../../lib/importantMail';

const { gmail } = vi.hoisted(() => ({
  gmail: {
    configured: true,
    fetchInbox: vi.fn(),
    fetchProfileEmail: vi.fn(),
    fetchKnownSenders: vi.fn(),
    rankMail: vi.fn(),
  },
}));

vi.mock('../../lib/googleAuth', () => ({
  hasGoogleClientId: () => gmail.configured,
  GMAIL_SCOPE: 'gmail-scope',
  getAccessToken: vi.fn(),
}));
vi.mock('../../lib/gmail', async (importOriginal) => ({
  // Keep the real `senderName` — the widget's display of it is worth testing.
  ...(await importOriginal<typeof import('../../lib/gmail')>()),
  fetchInbox: (interactive: boolean) => gmail.fetchInbox(interactive),
  fetchProfileEmail: () => gmail.fetchProfileEmail(),
  fetchKnownSenders: (messages: MailSummary[]) => gmail.fetchKnownSenders(messages),
}));
vi.mock('../../lib/importantMail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/importantMail')>()),
  rankMail: (...args: unknown[]) => gmail.rankMail(...args),
}));

/** `fetchInbox`'s argument: whether a consent popup is allowed. */
const INTERACTIVE = true;
const SILENT = false;

const message = (id: string, overrides: Partial<MailSummary> = {}): MailSummary => ({
  id,
  from: `Alice Smith <${id}@example.com>`,
  subject: `Subject ${id}`,
  snippet: 'preview',
  receivedAt: Date.now(),
  unread: true,
  to: ['you@example.com'],
  cc: [],
  deliveredTo: [],
  listHeaders: false,
  autoHeaders: false,
  threaded: false,
  labels: { important: false, starred: false, updates: false, forums: false },
  ...overrides,
});

const ranked = (ids: string[]): RankedMail[] =>
  ids.map((id) => ({
    message: message(id),
    reason: `because ${id}`,
    score: 42.5,
    signals: [
      { key: 'to', phrase: 'addressed to you', tier: 2, points: 14, factor: 1 },
      { key: 'bulk', phrase: '', tier: 3, points: 0, factor: 0.25 },
    ],
  }));

/** Marks Gmail as already connected, as a returning user would be. */
function seedConnected() {
  window.localStorage.setItem('mail.connected', JSON.stringify(true));
}

/** Dismisses `subject`, which is what the button is labelled by. */
const dismiss = (user: ReturnType<typeof userEvent.setup>, subject: string) =>
  user.click(screen.getByRole('button', { name: `Dismiss ${subject}` }));

/** Opens the full-screen view, where the dismissed list lives. */
const openFullScreen = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Show Mail full screen' }));

/** The ids currently remembered as dismissed. */
const storedDismissed = () => window.localStorage.getItem('mail.dismissed');

beforeEach(() => {
  gmail.configured = true;
  gmail.fetchInbox.mockReset().mockResolvedValue([message('a')]);
  gmail.fetchProfileEmail.mockReset().mockResolvedValue('you@example.com');
  gmail.fetchKnownSenders.mockReset().mockResolvedValue(new Set<string>());
  gmail.rankMail.mockReset().mockReturnValue(ranked(['a', 'b', 'c']));
});

describe('MailWidget before it is connected', () => {
  it('names the missing Google client id rather than failing blankly', () => {
    gmail.configured = false;

    render(<MailWidget />);

    expect(screen.getByText(/VITE_GOOGLE_CLIENT_ID/)).toBeInTheDocument();
  });

  it('needs nothing but Gmail — there is no key to ask for', () => {
    render(<MailWidget />);

    expect(screen.getByRole('button', { name: 'Connect Gmail' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/sk-ant/i)).not.toBeInTheDocument();
  });

  it('says where the mail goes before asking to read it', () => {
    render(<MailWidget />);

    expect(screen.getByText(/scored here in your browser/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is sent anywhere/i)).toBeInTheDocument();
  });

  it('touches Gmail not at all before Connect is clicked', async () => {
    // The cached-resource hook runs its loader on mount regardless of its key,
    // so without an explicit guard the panel would read the user's mail before
    // they ever asked it to.
    render(<MailWidget />);

    await screen.findByRole('button', { name: 'Connect Gmail' });

    expect(gmail.fetchInbox).not.toHaveBeenCalled();
    expect(gmail.rankMail).not.toHaveBeenCalled();
  });

  it('connects Gmail on the button, letting Google prompt for consent', async () => {
    const user = userEvent.setup();
    render(<MailWidget />);

    await user.click(screen.getByRole('button', { name: 'Connect Gmail' }));

    expect(gmail.fetchInbox).toHaveBeenCalledWith(INTERACTIVE);
    await waitFor(() => expect(window.localStorage.getItem('mail.connected')).toBe('true'));
  });

  it('reports a refused Google consent instead of looking connected', async () => {
    gmail.fetchInbox.mockImplementationOnce(async () => {
      throw new Error('access_denied');
    });
    const user = userEvent.setup();
    render(<MailWidget />);

    await user.click(screen.getByRole('button', { name: 'Connect Gmail' }));

    expect(await screen.findByText('access_denied')).toBeInTheDocument();
    expect(window.localStorage.getItem('mail.connected')).not.toBe('true');
  });
});

describe('MailWidget ranked picks', () => {
  it('shows each pick with its reason', async () => {
    seedConnected();

    render(<MailWidget />);

    expect(await screen.findByText('Subject a')).toBeInTheDocument();
    expect(screen.getByText('because a')).toBeInTheDocument();
  });

  it('links each pick into Gmail', async () => {
    seedConnected();

    render(<MailWidget />);
    await screen.findByText('Subject a');

    expect(screen.getByRole('link', { name: 'Subject a' })).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/u/0/#inbox/a',
    );
  });

  it('shows the sender by display name, not the raw header', async () => {
    seedConnected();

    render(<MailWidget />);
    await screen.findByText('Subject a');

    expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0);
  });

  it('reads a connected inbox without prompting for consent again', async () => {
    seedConnected();

    render(<MailWidget />);
    await screen.findByText('Subject a');

    expect(gmail.fetchInbox).toHaveBeenCalledWith(SILENT);
  });

  it('scores against the signed-in address and the senders you have written to', async () => {
    seedConnected();
    gmail.fetchKnownSenders.mockResolvedValue(new Set(['a@example.com']));

    render(<MailWidget />);
    await screen.findByText('Subject a');

    const [, context] = gmail.rankMail.mock.calls[0];
    expect(context.self).toBe('you@example.com');
    expect(context.knownSenders).toEqual(new Set(['a@example.com']));
  });

  it('exposes the full arithmetic on hover, which is the point of scoring locally', async () => {
    seedConnected();

    render(<MailWidget />);
    await screen.findByText('Subject a');

    expect(screen.getByText('Subject a').closest('li')).toHaveAttribute(
      'title',
      'score 42.5 — to +14, bulk ×0.25',
    );
  });

  it('shows only the top three, however deep the ranking runs', async () => {
    seedConnected();
    gmail.rankMail.mockReturnValue(ranked(['a', 'b', 'c', 'd', 'e']));

    render(<MailWidget />);
    await screen.findByText('Subject a');

    expect(screen.getByText('Subject c')).toBeInTheDocument();
    expect(screen.queryByText('Subject d')).not.toBeInTheDocument();
  });

  it('says so when nothing needs attention', async () => {
    seedConnected();
    gmail.rankMail.mockReturnValue([]);

    render(<MailWidget />);

    expect(await screen.findByText(/nothing in the last week needs you/i)).toBeInTheDocument();
  });

  it('surfaces a read failure with a retry rather than an empty panel', async () => {
    seedConnected();
    gmail.fetchInbox.mockImplementation(async () => {
      throw new Error('403');
    });

    render(<MailWidget />);

    expect(await screen.findByText(/couldn.t read your mail/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('offers a refresh that costs nothing to take', async () => {
    seedConnected();
    const user = userEvent.setup();
    render(<MailWidget />);
    await screen.findByText('Subject a');

    await user.click(screen.getByRole('button', { name: 'Refresh mail now' }));

    await waitFor(() => expect(gmail.fetchInbox.mock.calls.length).toBeGreaterThan(1));
  });
});

describe('MailWidget dismissing a pick', () => {
  it('pulls up the next most important message in its place', async () => {
    seedConnected();
    gmail.rankMail.mockReturnValue(ranked(['a', 'b', 'c', 'd']));
    const user = userEvent.setup();
    render(<MailWidget />);
    await screen.findByText('Subject a');
    // The fourth is ranked but off the end of the panel's window.
    expect(screen.queryByText('Subject d')).not.toBeInTheDocument();

    await dismiss(user, 'Subject a');

    expect(screen.queryByText('Subject a')).not.toBeInTheDocument();
    expect(await screen.findByText('Subject d')).toBeInTheDocument();
  });

  it('leaves the survivors in the order they were ranked', async () => {
    seedConnected();
    gmail.rankMail.mockReturnValue(ranked(['a', 'b', 'c', 'd']));
    const user = userEvent.setup();
    render(<MailWidget />);
    await screen.findByText('Subject a');

    await dismiss(user, 'Subject a');

    expect(screen.getByText('Subject b')).toBeInTheDocument();
    expect(screen.getByText('Subject c')).toBeInTheDocument();
  });

  it('costs nothing to dismiss — no re-read, no round trip to Gmail', async () => {
    seedConnected();
    const user = userEvent.setup();
    render(<MailWidget />);
    await screen.findByText('Subject a');
    const readsBefore = gmail.fetchInbox.mock.calls.length;

    await dismiss(user, 'Subject a');

    // Promoting the next pick is a slice of a ranking already in hand. Going
    // back to Gmail for it would make an instant act wait on the network.
    expect(await screen.findByText('Subject b')).toBeInTheDocument();
    expect(gmail.fetchInbox.mock.calls.length).toBe(readsBefore);
    expect(gmail.rankMail.mock.calls.length).toBe(1);
  });

  it('keeps a dismissal across a reload, not just until the next poll', async () => {
    seedConnected();
    const user = userEvent.setup();
    const firstVisit = render(<MailWidget />);
    await screen.findByText('Subject a');
    await dismiss(user, 'Subject a');
    await waitFor(() => expect(storedDismissed()).toBe(JSON.stringify(['a'])));

    firstVisit.unmount();
    render(<MailWidget />);

    expect(await screen.findByText('Subject b')).toBeInTheDocument();
    expect(screen.queryByText('Subject a')).not.toBeInTheDocument();
  });

  it('says how many it is holding back', async () => {
    seedConnected();
    const user = userEvent.setup();
    render(<MailWidget />);
    await screen.findByText('Subject a');

    await dismiss(user, 'Subject a');

    expect(await screen.findByText(/1 dismissed/)).toBeInTheDocument();
  });

  it('gives them all back on Restore', async () => {
    seedConnected();
    const user = userEvent.setup();
    render(<MailWidget />);
    await screen.findByText('Subject a');
    await dismiss(user, 'Subject a');
    await screen.findByText(/1 dismissed/);

    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(await screen.findByText('Subject a')).toBeInTheDocument();
    expect(screen.queryByText(/1 dismissed/)).not.toBeInTheDocument();
  });

  it('offers the way back when every pick has been dismissed', async () => {
    seedConnected();
    gmail.rankMail.mockReturnValue(ranked(['a']));
    const user = userEvent.setup();
    render(<MailWidget />);
    await screen.findByText('Subject a');

    await dismiss(user, 'Subject a');

    // Distinct from an inbox that never had anything — this one you emptied.
    expect(await screen.findByText(/you.ve dismissed the rest/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing in the last week needs you/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('forgets a dismissal once that mail drops out of the ranking', async () => {
    seedConnected();
    window.localStorage.setItem('mail.dismissed', JSON.stringify(['a', 'gone']));

    render(<MailWidget />);
    await screen.findByText('Subject b');

    // `gone` is no longer ranked — remembering it forever would grow the list
    // without bound. `a` is still ranked, so it stays dismissed.
    await waitFor(() => expect(storedDismissed()).toBe(JSON.stringify(['a'])));
    expect(screen.queryByText('Subject a')).not.toBeInTheDocument();
  });

  it('does not forget dismissals while the ranking is still loading', async () => {
    seedConnected();
    window.localStorage.setItem('mail.dismissed', JSON.stringify(['a']));
    // A read that never settles: the panel sits in `loading` with no ranking to
    // prune against, and must not take that for "none of these exist".
    gmail.fetchInbox.mockImplementation(() => new Promise(() => {}));

    render(<MailWidget />);
    await screen.findByRole('status', { name: 'Reading your inbox' });

    expect(storedDismissed()).toBe(JSON.stringify(['a']));
  });
});

describe('MailWidget recently-dismissed list', () => {
  it('stays out of the card, which has no room for it', async () => {
    seedConnected();
    const user = userEvent.setup();
    render(<MailWidget />);
    await screen.findByText('Subject a');

    await dismiss(user, 'Subject a');

    // The card gets the one-line count; spending one of three rows on mail you
    // already waved away would defeat the dismissing.
    expect(await screen.findByText(/1 dismissed/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recently dismissed' })).not.toBeInTheDocument();
  });

  it('lists what was dismissed, newest first, once opened full screen', async () => {
    seedConnected();
    const user = userEvent.setup();
    render(<MailWidget />);
    await screen.findByText('Subject a');
    await dismiss(user, 'Subject a');
    await dismiss(user, 'Subject b');

    await openFullScreen(user);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Recently dismissed' })).toBeInTheDocument();
    // Most recently dismissed leads — `b` went second, so it comes first.
    const restoreButtons = within(dialog).getAllByRole('button', { name: /^Restore Subject/ });
    expect(restoreButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Restore Subject b',
      'Restore Subject a',
    ]);
  });

  it('takes one message back without disturbing the others', async () => {
    seedConnected();
    gmail.rankMail.mockReturnValue(ranked(['a', 'b', 'c', 'd', 'e']));
    const user = userEvent.setup();
    render(<MailWidget />);
    await screen.findByText('Subject a');
    await dismiss(user, 'Subject a');
    await dismiss(user, 'Subject b');
    await openFullScreen(user);

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Restore Subject a' }));

    // `a` outranks everything, so it returns to the top of the picks.
    await waitFor(() =>
      expect(within(screen.getByRole('dialog')).getAllByRole('link')[0]).toHaveAccessibleName(
        'Subject a',
      ),
    );
    // `b` was not touched, so it stays on the list.
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore Subject b' }),
    ).toBeInTheDocument();
  });

  it('says plainly that nothing was removed from Gmail', async () => {
    seedConnected();
    const user = userEvent.setup();
    render(<MailWidget />);
    await screen.findByText('Subject a');
    await dismiss(user, 'Subject a');

    await openFullScreen(user);

    // The panel reads someone's real inbox; a list of set-aside mail must not
    // leave them wondering whether it was deleted.
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/nothing was removed from Gmail/i)).toBeInTheDocument();
  });
});
