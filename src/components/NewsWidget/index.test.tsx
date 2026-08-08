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

/** The sources the widget ships with, in tab order. */
const SHIPPED_SOURCES = ['BBC Top', 'World', 'Tech', 'NPR', 'Hacker News'];

function stubFeed(xml = RSS) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(xml) })),
  );
}

/** The first headline in the stubbed feed, and the widget's readiness signal. */
const firstHeadline = () => screen.getByRole('link', { name: 'Headline One' });
const waitForHeadlines = () => screen.findByRole('link', { name: 'Headline One' });

/** A source tab. */
const sourceTab = (name: string) => screen.getByRole('button', { name });

/** Opens the manage view, as the header button does. */
const openManageView = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Manage sources' }));

/** Leaves the manage view. */
const closeManageView = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Done managing sources' }));

/** The source list as it was persisted. */
const storedSourceIds = () =>
  JSON.parse(localStorage.getItem('news.sources')!).map((feed: { id: string }) => feed.id);

describe('NewsWidget headlines', () => {
  it('parses the RSS feed and lists the headlines with links', async () => {
    stubFeed();

    render(<NewsWidget />);

    expect(await waitForHeadlines()).toHaveAttribute('href', 'https://example.com/one');
    expect(screen.getByRole('link', { name: 'Headline Two' })).toBeInTheDocument();
  });

  it('shows an error state with a retry when the feed fails to load', async () => {
    // Default test fetch rejects → error branch.
    render(<NewsWidget />);

    expect(await screen.findByText(/Couldn't load this feed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('keeps stale headlines on screen when a refresh fails', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);
    await waitForHeadlines();

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    // A stale headline beats an error message.
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(firstHeadline()).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load this feed/i)).not.toBeInTheDocument();
  });
});

describe('NewsWidget switching sources', () => {
  it('marks the chosen source as the active tab', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);
    await waitForHeadlines();

    await user.click(sourceTab('Tech'));

    expect(sourceTab('Tech')).toHaveClass(styles.isActive);
    expect(sourceTab('Tech')).toHaveAttribute('aria-pressed', 'true');
  });

  it('persists the selection', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);
    await waitForHeadlines();

    await user.click(sourceTab('Tech'));

    expect(localStorage.getItem('news.feed')).toBe(JSON.stringify('bbc-tech'));
  });
});

describe('NewsWidget caching', () => {
  it('paints a re-mounted panel from cache, with no loading placeholder', async () => {
    stubFeed();
    const { unmount } = render(<NewsWidget />);
    await waitForHeadlines();

    unmount();
    render(<NewsWidget />);

    expect(firstHeadline()).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /loading headlines/i })).not.toBeInTheDocument();
  });

  it('does not fetch again for a re-mounted panel', async () => {
    stubFeed();
    const { unmount } = render(<NewsWidget />);
    await waitForHeadlines();
    expect(fetch).toHaveBeenCalledTimes(1);

    unmount();
    render(<NewsWidget />);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('re-reads a source it already loaded without another fetch', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);
    await waitForHeadlines();
    await user.click(sourceTab('Tech'));
    await waitForHeadlines();
    expect(fetch).toHaveBeenCalledTimes(2); // a different feed is a different key

    await user.click(sourceTab('BBC Top'));

    expect(firstHeadline()).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refreshes on demand even when the cached copy is fresh', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);
    await waitForHeadlines();

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});

describe('NewsWidget managing sources', () => {
  it('removes a source, so it is no longer offered as a tab', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);
    await waitForHeadlines();

    await openManageView(user);
    await user.click(screen.getByRole('button', { name: 'Remove NPR' }));
    await closeManageView(user);

    expect(screen.queryByRole('button', { name: 'NPR' })).not.toBeInTheDocument();
    expect(sourceTab('Tech')).toBeInTheDocument();
  });

  it('persists the shortened source list', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);
    await waitForHeadlines();

    await openManageView(user);
    await user.click(screen.getByRole('button', { name: 'Remove NPR' }));

    expect(storedSourceIds()).not.toContain('npr');
  });

  it('falls back to another source when the one on screen is removed', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);
    await waitForHeadlines();

    // BBC Top is the source being shown.
    await openManageView(user);
    await user.click(screen.getByRole('button', { name: 'Remove BBC Top' }));
    await closeManageView(user);

    expect(sourceTab('World')).toHaveAttribute('aria-pressed', 'true');
    expect(await waitForHeadlines()).toBeInTheDocument();
  });

  it('adds a source and switches to it', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);
    await waitForHeadlines();

    await openManageView(user);
    await user.type(screen.getByLabelText('Source name'), 'The Verge');
    await user.type(screen.getByLabelText('Feed URL'), 'https://theverge.com/rss');
    await user.click(screen.getByRole('button', { name: /add/i }));
    await closeManageView(user);

    expect(sourceTab('The Verge')).toHaveClass(styles.isActive);
    expect(await waitForHeadlines()).toBeInTheDocument();
  });

  it('fetches the newly added feed', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);
    await waitForHeadlines();

    await openManageView(user);
    await user.type(screen.getByLabelText('Feed URL'), 'https://theverge.com/rss');
    await user.click(screen.getByRole('button', { name: /add/i }));
    await closeManageView(user);

    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining(encodeURIComponent('https://theverge.com/rss')),
    );
  });

  it('names an unnamed source after its host', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);

    await openManageView(user);
    await user.type(screen.getByLabelText('Feed URL'), 'https://www.theverge.com/rss');
    await user.click(screen.getByRole('button', { name: /add/i }));

    expect(screen.getByRole('button', { name: 'Remove theverge.com' })).toBeInTheDocument();
  });

  it('explains an address it cannot use instead of adding it', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);

    await openManageView(user);
    await user.type(screen.getByLabelText('Feed URL'), 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: /add/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/doesn’t look like a feed address/i);
    // The typed value is kept, so it can be corrected rather than retyped.
    expect(screen.getByLabelText('Feed URL')).toHaveValue('javascript:alert(1)');
  });

  it('refuses to add the same source twice', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);

    await openManageView(user);
    await user.type(screen.getByLabelText('Feed URL'), 'https://feeds.npr.org/1001/rss.xml');
    await user.click(screen.getByRole('button', { name: /add/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/already in the list/i);
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(
      SHIPPED_SOURCES.length,
    );
  });

  it('stays in the manage view when every source has been removed', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);

    await openManageView(user);
    for (const label of SHIPPED_SOURCES) {
      await user.click(screen.getByRole('button', { name: `Remove ${label}` }));
    }

    expect(screen.getByText(/No sources yet/i)).toBeInTheDocument();
    // There is nothing to go back to, so the view cannot be dismissed.
    await closeManageView(user);
    expect(screen.getByText(/No sources yet/i)).toBeInTheDocument();
  });

  it('offers no restore while the shipped list is untouched', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);

    await openManageView(user);

    expect(screen.queryByRole('button', { name: /restore the default/i })).not.toBeInTheDocument();
  });

  it('restores the shipped sources after they have been edited', async () => {
    stubFeed();
    const user = userEvent.setup();
    render(<NewsWidget />);
    await openManageView(user);
    await user.click(screen.getByRole('button', { name: 'Remove NPR' }));

    await user.click(screen.getByRole('button', { name: /restore the default/i }));

    expect(screen.getByRole('button', { name: 'Remove NPR' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore the default/i })).not.toBeInTheDocument();
  });

  it('reads a saved source list back on the next visit', async () => {
    localStorage.setItem(
      'news.sources',
      JSON.stringify([{ id: 'custom:x', label: 'Only This', url: 'https://example.com/rss' }]),
    );
    stubFeed();

    render(<NewsWidget />);
    await waitForHeadlines();

    expect(sourceTab('Only This')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'NPR' })).not.toBeInTheDocument();
  });
});
