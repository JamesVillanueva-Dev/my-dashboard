import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewsWidget from './NewsWidget';

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Headline One</title>
    <link>https://example.com/one</link>
    <pubDate>Wed, 22 Jul 2026 12:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Headline Two</title>
    <link>https://example.com/two</link>
    <pubDate>Wed, 22 Jul 2026 11:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

function stubFeed(xml = RSS) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(xml) })),
  );
}

describe('NewsWidget', () => {
  it('parses the RSS feed and lists headlines with links', async () => {
    stubFeed();
    render(<NewsWidget />);

    const first = await screen.findByRole('link', { name: 'Headline One' });
    expect(first).toHaveAttribute('href', 'https://example.com/one');
    expect(screen.getByRole('link', { name: 'Headline Two' })).toBeInTheDocument();
  });

  it('shows an error state with a retry when the feed fails to load', async () => {
    // Default test fetch rejects → error branch.
    render(<NewsWidget />);
    expect(await screen.findByText(/Couldn't load this feed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('switches feeds and persists the selection', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);
    await screen.findByRole('link', { name: 'Headline One' });

    await user.click(screen.getByRole('button', { name: 'Tech' }));

    expect(screen.getByRole('button', { name: 'Tech' })).toHaveClass('is-active');
    expect(localStorage.getItem('news.feed')).toBe(JSON.stringify('bbc-tech'));
  });
});
