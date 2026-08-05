import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MailWidget from './index';
import type { MailSummary } from '../../lib/gmail';
import type { RankedMail } from '../../lib/importantMail';

const { state } = vi.hoisted(() => ({
  state: { configured: true, fetchInbox: vi.fn(), rankMail: vi.fn() },
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
  ...over,
});

const ranked = (ids: string[]): RankedMail[] =>
  ids.map((id) => ({ message: message(id), reason: `because ${id}` }));

/** Marks Gmail as already connected, as a returning user would be. */
function connected() {
  window.localStorage.setItem('mail.connected', JSON.stringify(true));
}

/** Supplies a pasted API key, as if one had been saved earlier this session. */
function withKey() {
  window.sessionStorage.setItem('anthropic.apiKey', 'sk-ant-testkey123456');
}

beforeEach(() => {
  state.configured = true;
  state.fetchInbox.mockReset().mockResolvedValue([message('a')]);
  state.rankMail.mockReset().mockResolvedValue(ranked(['a', 'b', 'c']));
  window.sessionStorage.clear();
});

describe('MailWidget — setup states', () => {
  it('names the missing Google client id rather than failing blankly', () => {
    state.configured = false;
    render(<MailWidget />);
    expect(screen.getByText(/VITE_GOOGLE_CLIENT_ID/)).toBeInTheDocument();
  });

  it('asks for an Anthropic key before anything else, and says where it goes', () => {
    render(<MailWidget />);

    expect(screen.getByLabelText('Anthropic API key')).toBeInTheDocument();
    expect(screen.getByText(/never saved to your account/i)).toBeInTheDocument();
    expect(screen.getByText(/message bodies are not/i)).toBeInTheDocument();
  });

  it('keeps the key field as a password input, not plain text', () => {
    render(<MailWidget />);
    expect(screen.getByLabelText('Anthropic API key')).toHaveAttribute('type', 'password');
  });

  it('rejects something that is not an Anthropic key', async () => {
    const user = userEvent.setup();
    render(<MailWidget />);

    await user.type(screen.getByLabelText('Anthropic API key'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Save key' }));

    expect(screen.getByText(/start with/i)).toBeInTheDocument();
    expect(window.sessionStorage.getItem('anthropic.apiKey')).toBeNull();
  });

  it('stores an accepted key in sessionStorage, never localStorage', async () => {
    const user = userEvent.setup();
    render(<MailWidget />);

    await user.type(screen.getByLabelText('Anthropic API key'), 'sk-ant-abcdefgh12345');
    await user.click(screen.getByRole('button', { name: 'Save key' }));

    expect(window.sessionStorage.getItem('anthropic.apiKey')).toBe('sk-ant-abcdefgh12345');
    // localStorage would be swept into the account-synced snapshot (ADR 0008).
    expect(JSON.stringify(window.localStorage)).not.toContain('sk-ant-');
  });

  it('offers to connect Gmail once a key is present', async () => {
    withKey();
    const user = userEvent.setup();
    render(<MailWidget />);

    await user.click(screen.getByRole('button', { name: 'Connect Gmail' }));

    // Interactive, so Google is allowed to show its consent popup.
    expect(state.fetchInbox).toHaveBeenCalledWith(true);
    await waitFor(() => expect(window.localStorage.getItem('mail.connected')).toBe('true'));
  });

  it('touches neither Gmail nor Claude before Connect is clicked', async () => {
    // The cached-resource hook runs its loader on mount regardless of its key,
    // so without an explicit guard the panel would read the user's mail and
    // spend their Anthropic credit before they ever asked it to.
    withKey();
    render(<MailWidget />);

    await screen.findByRole('button', { name: 'Connect Gmail' });
    expect(state.fetchInbox).not.toHaveBeenCalled();
    expect(state.rankMail).not.toHaveBeenCalled();
  });

  it('does not call Claude when there is no key, even once connected', async () => {
    connected();
    render(<MailWidget />);

    await screen.findByLabelText('Anthropic API key');
    expect(state.rankMail).not.toHaveBeenCalled();
  });

  it('reports a refused Google consent instead of looking connected', async () => {
    withKey();
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
  it('shows the picks with Claude’s reason and a link into Gmail', async () => {
    connected();
    withKey();
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
    withKey();
    render(<MailWidget />);

    await screen.findByText('Subject a');
    expect(state.fetchInbox).toHaveBeenCalledWith(false);
  });

  it('says so when nothing needs attention', async () => {
    connected();
    withKey();
    state.rankMail.mockResolvedValue([]);
    render(<MailWidget />);

    expect(await screen.findByText(/nothing in the last week needs you/i)).toBeInTheDocument();
  });

  it('surfaces a ranking failure with a retry rather than an empty panel', async () => {
    connected();
    withKey();
    state.rankMail.mockImplementation(async () => {
      throw new Error('401');
    });
    render(<MailWidget />);

    expect(await screen.findByText(/couldn.t rank your mail/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('discloses that ranking is done by Claude, and that bodies stay put', async () => {
    connected();
    withKey();
    render(<MailWidget />);

    await screen.findByText('Subject a');
    expect(screen.getByText(/ranked by claude/i)).toBeInTheDocument();
    expect(screen.getByText(/bodies stay in gmail/i)).toBeInTheDocument();
  });

  it('can forget a pasted key, dropping back to the prompt', async () => {
    connected();
    withKey();
    const user = userEvent.setup();
    render(<MailWidget />);

    await screen.findByText('Subject a');
    await user.click(screen.getByRole('button', { name: 'Forget API key' }));

    await waitFor(() => expect(screen.getByLabelText('Anthropic API key')).toBeInTheDocument());
    expect(window.sessionStorage.getItem('anthropic.apiKey')).toBeNull();
  });
});
