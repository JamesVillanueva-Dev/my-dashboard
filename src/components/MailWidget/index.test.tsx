import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('offers a refresh that costs nothing to take', async () => {
    connected();
    const user = userEvent.setup();
    render(<MailWidget />);

    await screen.findByText('Subject a');
    await user.click(screen.getByRole('button', { name: 'Refresh mail now' }));

    await waitFor(() => expect(state.fetchInbox.mock.calls.length).toBeGreaterThan(1));
  });
});
