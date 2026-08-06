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

    // Present on the very first render — no loading placeholders in between.
    expect(screen.getByRole('link', { name: 'Headline One' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /loading headlines/i })).not.toBeInTheDocument();
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

  describe('managing sources', () => {
    /** Opens the manage view, as the header button does. */
    async function manage(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('button', { name: 'Manage sources' }));
    }

    it('removes a source, so it is no longer offered as a tab', async () => {
      stubFeed();
      const user = userEvent.setup();
      render(<NewsWidget />);
      await screen.findByRole('link', { name: 'Headline One' });

      await manage(user);
      await user.click(screen.getByRole('button', { name: 'Remove NPR' }));
      await user.click(screen.getByRole('button', { name: 'Done managing sources' }));

      expect(screen.queryByRole('button', { name: 'NPR' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tech' })).toBeInTheDocument();
      const saved = JSON.parse(localStorage.getItem('news.sources')!);
      expect(saved.map((f: { id: string }) => f.id)).not.toContain('npr');
    });

    it('falls back to another source when the one on screen is removed', async () => {
      stubFeed();
      const user = userEvent.setup();
      render(<NewsWidget />);
      await screen.findByRole('link', { name: 'Headline One' });

      // BBC Top is the source being shown.
      await manage(user);
      await user.click(screen.getByRole('button', { name: 'Remove BBC Top' }));
      await user.click(screen.getByRole('button', { name: 'Done managing sources' }));

      expect(screen.getByRole('button', { name: 'World' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(await screen.findByRole('link', { name: 'Headline One' })).toBeInTheDocument();
    });

    it('adds a source and switches to it', async () => {
      stubFeed();
      const user = userEvent.setup();
      render(<NewsWidget />);
      await screen.findByRole('link', { name: 'Headline One' });

      await manage(user);
      await user.type(screen.getByLabelText('Source name'), 'The Verge');
      await user.type(screen.getByLabelText('Feed URL'), 'https://theverge.com/rss');
      await user.click(screen.getByRole('button', { name: /add/i }));
      await user.click(screen.getByRole('button', { name: 'Done managing sources' }));

      const tab = screen.getByRole('button', { name: 'The Verge' });
      expect(tab).toHaveClass(styles.isActive);
      expect(await screen.findByRole('link', { name: 'Headline One' })).toBeInTheDocument();
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringContaining(encodeURIComponent('https://theverge.com/rss')),
      );
    });

    it('names an unnamed source after its host', async () => {
      stubFeed();
      const user = userEvent.setup();
      render(<NewsWidget />);

      await manage(user);
      await user.type(screen.getByLabelText('Feed URL'), 'https://www.theverge.com/rss');
      await user.click(screen.getByRole('button', { name: /add/i }));

      expect(screen.getByRole('button', { name: 'Remove theverge.com' })).toBeInTheDocument();
    });

    it('explains an address it cannot use instead of adding it', async () => {
      stubFeed();
      const user = userEvent.setup();
      render(<NewsWidget />);

      await manage(user);
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

      await manage(user);
      await user.type(screen.getByLabelText('Feed URL'), 'https://feeds.npr.org/1001/rss.xml');
      await user.click(screen.getByRole('button', { name: /add/i }));

      expect(screen.getByRole('alert')).toHaveTextContent(/already in the list/i);
      expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(5);
    });

    it('stays in the manage view when every source has been removed', async () => {
      stubFeed();
      const user = userEvent.setup();
      render(<NewsWidget />);

      await manage(user);
      for (const label of ['BBC Top', 'World', 'Tech', 'NPR', 'Hacker News']) {
        await user.click(screen.getByRole('button', { name: `Remove ${label}` }));
      }

      expect(screen.getByText(/No sources yet/i)).toBeInTheDocument();
      // There is nothing to go back to, so the view cannot be dismissed.
      await user.click(screen.getByRole('button', { name: 'Done managing sources' }));
      expect(screen.getByText(/No sources yet/i)).toBeInTheDocument();
    });

    it('restores the shipped sources after they have been edited', async () => {
      stubFeed();
      const user = userEvent.setup();
      render(<NewsWidget />);

      await manage(user);
      // Untouched, there is nothing to restore.
      expect(screen.queryByRole('button', { name: /restore the default/i })).not.toBeInTheDocument();

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

      await screen.findByRole('link', { name: 'Headline One' });
      expect(screen.getByRole('button', { name: 'Only This' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'NPR' })).not.toBeInTheDocument();
    });
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
