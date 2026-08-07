import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MailWidget from './index';
import type { MailSummary } from '../../lib/gmail';
import type { RankedMail } from '../../lib/importantMail';

const { state } = vi.hoisted(() => ({
  state: {
    configured: true,
    fetchInbox: vi.fn(),
    fetchProfileEmail: vi.fn(),
    fetchKnownSenders: vi.fn(),
    rankMail: vi.fn(),
  },
}));

vi.mock('../../lib/googleAuth', () => ({
  hasGoogleClientId: () => state.configured,
  GMAIL_SCOPE: 'gmail-scope',
  getAccessToken: vi.fn(),
}));
vi.mock('../../lib/gmail', async (importOriginal) => ({
  // Keep the real `senderName` — the widget's display of it is worth testing.
  ...(await importOriginal<typeof import('../../lib/gmail')>()),
  fetchInbox: (interactive: boolean) => state.fetchInbox(interactive),
  fetchProfileEmail: () => state.fetchProfileEmail(),
  fetchKnownSenders: (messages: MailSummary[]) => state.fetchKnownSenders(messages),
}));
vi.mock('../../lib/importantMail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/importantMail')>()),
  rankMail: (...args: unknown[]) => state.rankMail(...args),
}));

const message = (id: string, over: Partial<MailSummary> = {}): MailSummary => ({
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
  ...over,
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
function connected() {
  window.localStorage.setItem('mail.connected', JSON.stringify(true));
}

beforeEach(() => {
  state.configured = true;
  state.fetchInbox.mockReset().mockResolvedValue([message('a')]);
  state.fetchProfileEmail.mockReset().mockResolvedValue('you@example.com');
  state.fetchKnownSenders.mockReset().mockResolvedValue(new Set<string>());
  state.rankMail.mockReset().mockReturnValue(ranked(['a', 'b', 'c']));
});

describe('MailWidget — setup states', () => {
  it('names the missing Google client id rather than failing blankly', () => {
    state.configured = false;
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

  it('connects Gmail on the button', async () => {
    const user = userEvent.setup();
    render(<MailWidget />);

    await user.click(screen.getByRole('button', { name: 'Connect Gmail' }));

    // Interactive, so Google is allowed to show its consent popup.
    expect(state.fetchInbox).toHaveBeenCalledWith(true);
    await waitFor(() => expect(window.localStorage.getItem('mail.connected')).toBe('true'));
  });

  it('touches Gmail not at all before Connect is clicked', async () => {
    // The cached-resource hook runs its loader on mount regardless of its key,
    // so without an explicit guard the panel would read the user's mail before
    // they ever asked it to.
    render(<MailWidget />);

    await screen.findByRole('button', { name: 'Connect Gmail' });
    expect(state.fetchInbox).not.toHaveBeenCalled();
    expect(state.rankMail).not.toHaveBeenCalled();
  });

  it('reports a refused Google consent instead of looking connected', async () => {
    state.fetchInbox.mockImplementationOnce(async () => {
      throw new Error('access_denied');
    });
    const user = userEvent.setup();
    render(<MailWidget />);

    await user.click(screen.getByRole('button', { name: 'Connect Gmail' }));

    expect(await screen.findByText('access_denied')).toBeInTheDocument();
    expect(window.localStorage.getItem('mail.connected')).not.toBe('true');
  });
});

describe('MailWidget — ranked mail', () => {
  it('shows the picks with their reason and a link into Gmail', async () => {
    connected();
    render(<MailWidget />);

    expect(await screen.findByText('Subject a')).toBeInTheDocument();
    expect(screen.getByText('because a')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Subject a' })).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/u/0/#inbox/a',
    );
    // The sender is shown by display name, not the raw header.
    expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0);
  });

  it('ranks from a fetch that does not prompt for consent again', async () => {
    connected();
    render(<MailWidget />);

    await screen.findByText('Subject a');
    expect(state.fetchInbox).toHaveBeenCalledWith(false);
  });

  it('scores against the signed-in address and the senders you have written to', async () => {
    connected();
    state.fetchKnownSenders.mockResolvedValue(new Set(['a@example.com']));
    render(<MailWidget />);

    await screen.findByText('Subject a');
    const [, context] = state.rankMail.mock.calls[0];
    expect(context.self).toBe('you@example.com');
    expect(context.knownSenders).toEqual(new Set(['a@example.com']));
  });

  it('exposes the full arithmetic on hover, which is the point of scoring locally', async () => {
    connected();
    render(<MailWidget />);

    await screen.findByText('Subject a');
    const item = screen.getByText('Subject a').closest('li');
    expect(item).toHaveAttribute('title', 'score 42.5 — to +14, bulk ×0.25');
  });

  it('says so when nothing needs attention', async () => {
    connected();
    state.rankMail.mockReturnValue([]);
    render(<MailWidget />);

    expect(await screen.findByText(/nothing in the last week needs you/i)).toBeInTheDocument();
  });

  it('surfaces a read failure with a retry rather than an empty panel', async () => {
    connected();
    state.fetchInbox.mockImplementation(async () => {
      throw new Error('403');
    });
    render(<MailWidget />);

    expect(await screen.findByText(/couldn.t read your mail/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows only the top three, however deep the ranking runs', async () => {
    connected();
    state.rankMail.mockReturnValue(ranked(['a', 'b', 'c', 'd', 'e']));
    render(<MailWidget />);

    await screen.findByText('Subject a');
    expect(screen.getByText('Subject c')).toBeInTheDocument();
    expect(screen.queryByText('Subject d')).not.toBeInTheDocument();
  });

  it('offers a refresh that costs nothing to take', async () => {
    connected();
    const user = userEvent.setup();
    render(<MailWidget />);

    await screen.findByText('Subject a');
    await user.click(screen.getByRole('button', { name: 'Refresh mail now' }));

    await waitFor(() => expect(state.fetchInbox.mock.calls.length).toBeGreaterThan(1));
  });
});

describe('MailWidget — dismissing a pick', () => {
  /** Dismisses `subject`, which is what the button is labelled by. */
  async function dismiss(user: ReturnType<typeof userEvent.setup>, subject: string) {
    await user.click(screen.getByRole('button', { name: `Dismiss ${subject}` }));
  }

  it('pulls up the next most important message in its place', async () => {
    connected();
    state.rankMail.mockReturnValue(ranked(['a', 'b', 'c', 'd']));
    const user = userEvent.setup();
    render(<MailWidget />);

    await screen.findByText('Subject a');
    // The fourth is ranked but off the end of the panel's window.
    expect(screen.queryByText('Subject d')).not.toBeInTheDocument();

    await dismiss(user, 'Subject a');

    expect(screen.queryByText('Subject a')).not.toBeInTheDocument();
    expect(await screen.findByText('Subject d')).toBeInTheDocument();
    // The survivors keep their order; only the gap closed up.
    expect(screen.getByText('Subject b')).toBeInTheDocument();
    expect(screen.getByText('Subject c')).toBeInTheDocument();
  });

  it('costs nothing to dismiss — no re-read, no round trip to Gmail', async () => {
    connected();
    const user = userEvent.setup();
    render(<MailWidget />);

    await screen.findByText('Subject a');
    const readsBefore = state.fetchInbox.mock.calls.length;

    await dismiss(user, 'Subject a');

    // Promoting the next pick is a slice of a ranking already in hand. Going
    // back to Gmail for it would make an instant act wait on the network.
    expect(await screen.findByText('Subject b')).toBeInTheDocument();
    expect(state.fetchInbox.mock.calls.length).toBe(readsBefore);
    expect(state.rankMail.mock.calls.length).toBe(1);
  });

  it('keeps a dismissal across a reload, not just until the next poll', async () => {
    connected();
    const user = userEvent.setup();
    const view = render(<MailWidget />);

    await screen.findByText('Subject a');
    await dismiss(user, 'Subject a');
    await waitFor(() =>
      expect(window.localStorage.getItem('mail.dismissed')).toBe(JSON.stringify(['a'])),
    );

    view.unmount();
    render(<MailWidget />);

    expect(await screen.findByText('Subject b')).toBeInTheDocument();
    expect(screen.queryByText('Subject a')).not.toBeInTheDocument();
  });

  it('says how many it is holding back, and gives them all back', async () => {
    connected();
    const user = userEvent.setup();
    render(<MailWidget />);

    await screen.findByText('Subject a');
    await dismiss(user, 'Subject a');
    expect(await screen.findByText(/1 dismissed/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(await screen.findByText('Subject a')).toBeInTheDocument();
    expect(screen.queryByText(/1 dismissed/)).not.toBeInTheDocument();
  });

  it('offers the way back when every pick has been dismissed', async () => {
    connected();
    state.rankMail.mockReturnValue(ranked(['a']));
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
    connected();
    window.localStorage.setItem('mail.dismissed', JSON.stringify(['a', 'gone']));
    render(<MailWidget />);

    await screen.findByText('Subject b');
    // `gone` is no longer ranked — remembering it forever would grow the list
    // without bound. `a` is still ranked, so it stays dismissed.
    await waitFor(() =>
      expect(window.localStorage.getItem('mail.dismissed')).toBe(JSON.stringify(['a'])),
    );
    expect(screen.queryByText('Subject a')).not.toBeInTheDocument();
  });

  it('keeps the recently-dismissed list out of the card, which has no room for it', async () => {
    connected();
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
    connected();
    const user = userEvent.setup();
    render(<MailWidget />);

    await screen.findByText('Subject a');
    await dismiss(user, 'Subject a');
    await dismiss(user, 'Subject b');
    await user.click(screen.getByRole('button', { name: 'Show Mail full screen' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Recently dismissed' }),
    ).toBeInTheDocument();
    // Most recently dismissed leads — `b` went second, so it comes first.
    const restores = within(dialog).getAllByRole('button', { name: /^Restore Subject/ });
    expect(restores.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Restore Subject b',
      'Restore Subject a',
    ]);
  });

  it('takes one message back without disturbing the others', async () => {
    connected();
    state.rankMail.mockReturnValue(ranked(['a', 'b', 'c', 'd', 'e']));
    const user = userEvent.setup();
    render(<MailWidget />);

    await screen.findByText('Subject a');
    await dismiss(user, 'Subject a');
    await dismiss(user, 'Subject b');
    await user.click(screen.getByRole('button', { name: 'Show Mail full screen' }));

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
    connected();
    const user = userEvent.setup();
    render(<MailWidget />);

    await screen.findByText('Subject a');
    await dismiss(user, 'Subject a');
    await user.click(screen.getByRole('button', { name: 'Show Mail full screen' }));

    // The panel reads someone's real inbox; a list of set-aside mail must not
    // leave them wondering whether it was deleted.
    expect(
      await within(await screen.findByRole('dialog')).findByText(/nothing was removed from Gmail/i),
    ).toBeInTheDocument();
  });

  it('does not forget dismissals while the ranking is still loading', async () => {
    connected();
    window.localStorage.setItem('mail.dismissed', JSON.stringify(['a']));
    // A read that never settles: the panel sits in `loading` with no ranking to
    // prune against, and must not take that for "none of these exist".
    state.fetchInbox.mockImplementation(() => new Promise(() => {}));
    render(<MailWidget />);

    await screen.findByRole('status', { name: 'Reading your inbox' });
    expect(window.localStorage.getItem('mail.dismissed')).toBe(JSON.stringify(['a']));
  });
});
