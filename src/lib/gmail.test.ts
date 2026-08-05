import { describe, it, expect } from 'vitest';
import { parseAddressList, senderAddress, senderName, toSummary } from './gmail';

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

/** A raw message carrying `headers` on top of the defaults. */
const withHeaders = (headers: { name: string; value: string }[]) =>
  raw({ payload: { headers: [...raw().payload.headers, ...headers] } });

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
      to: [],
      cc: [],
      deliveredTo: [],
      listHeaders: false,
      autoHeaders: false,
      threaded: false,
      labels: { important: false, starred: false, updates: false, forums: false },
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
      to: [],
      cc: [],
      deliveredTo: [],
      listHeaders: false,
      autoHeaders: false,
      threaded: false,
      labels: { important: false, starred: false, updates: false, forums: false },
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

  it('parses recipients into lowercased addresses', () => {
    const summary = toSummary(
      withHeaders([
        { name: 'To', value: 'Me <ME@example.com>, other@example.com' },
        { name: 'Cc', value: 'Watcher <cc@example.com>' },
        { name: 'Delivered-To', value: 'alias@example.com' },
      ]),
    );

    expect(summary?.to).toEqual(['me@example.com', 'other@example.com']);
    expect(summary?.cc).toEqual(['cc@example.com']);
    expect(summary?.deliveredTo).toEqual(['alias@example.com']);
  });

  it('reads either mailing-list header as the bulk tell', () => {
    expect(toSummary(withHeaders([{ name: 'List-Unsubscribe', value: '<mailto:x@y.com>' }]))
      ?.listHeaders).toBe(true);
    expect(toSummary(withHeaders([{ name: 'List-Id', value: '<news.example.com>' }]))
      ?.listHeaders).toBe(true);
  });

  it('reads Precedence and Auto-Submitted as automation', () => {
    expect(toSummary(withHeaders([{ name: 'Precedence', value: 'bulk' }]))?.autoHeaders).toBe(true);
    expect(toSummary(withHeaders([{ name: 'Precedence', value: 'List' }]))?.autoHeaders).toBe(true);
    expect(
      toSummary(withHeaders([{ name: 'Auto-Submitted', value: 'auto-generated' }]))?.autoHeaders,
    ).toBe(true);
  });

  it('treats `Auto-Submitted: no` as the human it claims to be', () => {
    // The spec's way of saying "a person sent this" — reading any value at all
    // as automation would demote ordinary mail from compliant senders.
    expect(toSummary(withHeaders([{ name: 'Auto-Submitted', value: 'no' }]))?.autoHeaders).toBe(
      false,
    );
  });

  it('reads either threading header', () => {
    expect(toSummary(withHeaders([{ name: 'In-Reply-To', value: '<a@b>' }]))?.threaded).toBe(true);
    expect(toSummary(withHeaders([{ name: 'References', value: '<a@b> <c@d>' }]))?.threaded).toBe(
      true,
    );
  });

  it('resolves the labels ranking reads, and ignores the rest', () => {
    const summary = toSummary(
      raw({ labelIds: ['INBOX', 'IMPORTANT', 'STARRED', 'CATEGORY_UPDATES', 'Label_17'] }),
    );

    expect(summary?.labels).toEqual({
      important: true,
      starred: true,
      updates: true,
      forums: false,
    });
  });
});

describe('parseAddressList', () => {
  it('splits on the commas that separate addresses, not the ones inside names', () => {
    // The case a naive split(',') gets wrong — two recipients, not three.
    expect(parseAddressList('"Smith, Alice" <a@x.com>, bob@y.com')).toEqual([
      'a@x.com',
      'bob@y.com',
    ]);
  });

  it('takes the address out of angle brackets and lowercases it', () => {
    expect(parseAddressList('Alice Smith <Alice@Example.COM>')).toEqual(['alice@example.com']);
  });

  it('handles bare addresses and surrounding whitespace', () => {
    expect(parseAddressList('  a@x.com ,b@y.com  ')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('yields nothing for a header with no address in it', () => {
    expect(parseAddressList('undisclosed-recipients:;')).toEqual([]);
    expect(parseAddressList('')).toEqual([]);
    expect(parseAddressList(',,')).toEqual([]);
  });

  it('drops the malformed entries without losing the good ones', () => {
    expect(parseAddressList('not-an-address, good@x.com, <>')).toEqual(['good@x.com']);
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

describe('senderAddress', () => {
  it('takes the address, whatever the display name looks like', () => {
    expect(senderAddress('"Smith, Alice" <Alice@Example.com>')).toBe('alice@example.com');
    expect(senderAddress('bob@y.com')).toBe('bob@y.com');
  });

  it('is empty when the header holds no address', () => {
    expect(senderAddress('')).toBe('');
    expect(senderAddress('Mailer Daemon')).toBe('');
  });
});
