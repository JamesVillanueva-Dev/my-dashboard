import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewsWidget from './index';
import styles from './styles.module.css';

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

    const tab = screen.getByRole('button', { name: 'Tech' });
    expect(tab).toHaveClass(styles.isActive);
    expect(tab).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('news.feed')).toBe(JSON.stringify('bbc-tech'));
  });

  it('paints a re-mounted panel from cache without fetching again', async () => {
    stubFeed();
    const { unmount } = render(<NewsWidget />);
    await screen.findByRole('link', { name: 'Headline One' });
    expect(fetch).toHaveBeenCalledTimes(1);

    unmount();
    render(<NewsWidget />);

    // Present on the very first render — no "Loading headlines…" in between.
    expect(screen.getByRole('link', { name: 'Headline One' })).toBeInTheDocument();
    expect(screen.queryByText(/Loading headlines/i)).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('re-reads a feed it already loaded without another fetch', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);
    await screen.findByRole('link', { name: 'Headline One' });

    await user.click(screen.getByRole('button', { name: 'Tech' }));
    await screen.findByRole('link', { name: 'Headline One' });
    expect(fetch).toHaveBeenCalledTimes(2); // a different feed is a different key

    await user.click(screen.getByRole('button', { name: 'BBC Top' }));

    expect(screen.getByRole('link', { name: 'Headline One' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refreshes on demand even when the cached copy is fresh', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);
    await screen.findByRole('link', { name: 'Headline One' });

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it('keeps stale headlines on screen when a refresh fails', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);
    await screen.findByRole('link', { name: 'Headline One' });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    // A stale headline beats an error message.
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: 'Headline One' })).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load this feed/i)).not.toBeInTheDocument();
  });
});
