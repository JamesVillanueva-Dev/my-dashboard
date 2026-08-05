import { describe, it, expect } from 'vitest';
import { senderName, toSummary } from './gmail';

/** A raw Gmail `format=metadata` message. */
const raw = (over: Record<string, unknown> = {}) => ({
  id: 'msg-1',
  snippet: 'Hello there',
  internalDate: '1700000000000',
  labelIds: ['INBOX', 'UNREAD'],
  payload: {
    headers: [
      { name: 'From', value: 'Alice Smith <alice@example.com>' },
      { name: 'Subject', value: 'Budget sign-off' },
      { name: 'Date', value: 'Tue, 14 Nov 2023 22:13:20 +0000' },
    ],
  },
  ...over,
});

describe('toSummary', () => {
  it('reduces a message to the fields ranking needs', () => {
    const summary = toSummary(raw());

    expect(summary).toEqual({
      id: 'msg-1',
      from: 'Alice Smith <alice@example.com>',
      subject: 'Budget sign-off',
      snippet: 'Hello there',
      receivedAt: 1700000000000,
      unread: true,
    });
  });

  it('reads headers whatever case Gmail used', () => {
    const summary = toSummary(
      raw({ payload: { headers: [{ name: 'FROM', value: 'bob@example.com' }] } }),
    );
    expect(summary?.from).toBe('bob@example.com');
  });

  it('treats a message without the UNREAD label as read', () => {
    expect(toSummary(raw({ labelIds: ['INBOX'] }))?.unread).toBe(false);
  });

  it('survives a message missing headers, snippet, and date', () => {
    const summary = toSummary({ id: 'bare' });

    expect(summary).toEqual({
      id: 'bare',
      from: '',
      subject: '',
      snippet: '',
      receivedAt: 0,
      unread: false,
    });
  });

  it('drops a message with no id, which nothing could link to', () => {
    expect(toSummary({ snippet: 'orphan' })).toBeNull();
  });

  it('decodes the entities Gmail escapes into snippets', () => {
    const summary = toSummary(raw({ snippet: 'R&amp;D said &quot;yes&quot; &lt;finally&gt;' }));
    expect(summary?.snippet).toBe('R&D said "yes" <finally>');
  });

  it('does not double-decode an escaped entity', () => {
    // "&amp;lt;" is a literal "&lt;", not a less-than sign.
    expect(toSummary(raw({ snippet: '&amp;lt;' }))?.snippet).toBe('&lt;');
  });
});

describe('senderName', () => {
  it('takes the display name out of a From header', () => {
    expect(senderName('Alice Smith <alice@example.com>')).toBe('Alice Smith');
    expect(senderName('"Smith, Alice" <alice@example.com>')).toBe('Smith, Alice');
  });

  it('leaves a bare address alone', () => {
    expect(senderName('alice@example.com')).toBe('alice@example.com');
  });

  it('returns the raw header when it does not parse, rather than nothing', () => {
    expect(senderName('undisclosed-recipients:;')).toBe('undisclosed-recipients:;');
    expect(senderName('')).toBe('');
  });
});
