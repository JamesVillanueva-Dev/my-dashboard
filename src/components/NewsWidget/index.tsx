import { useState, type FormEvent } from 'react';
import Widget from '../Widget';
import Icon from '../Icon';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useCachedResource } from '../../hooks/useCachedResource';
import {
  BUILT_IN_FEEDS,
  addFeed,
  hostOf,
  isDefaultFeeds,
  makeFeed,
  normalizeFeeds,
  removeFeed,
  type Feed,
} from '../../lib/feeds';
import styles from './styles.module.css';

// Feeds are fetched through a free CORS proxy and parsed in-browser.
const PROXY = 'https://api.allorigins.win/raw?url=';

/** Headlines older than this are refreshed in the background when the panel is
 *  shown. The refresh button ignores it and fetches anyway. */
const TTL = 5 * 60_000;

/** One headline, as parsed out of a feed's `<item>`/`<entry>`. */
interface Article {
  /** Headline text. */
  title: string;
  /** Where the story lives; opened in a new tab. */
  link: string;
  /** The raw `<pubDate>`/`<published>` string, formatted for display by `ago`. */
  date: string;
}

/**
 * Formats an RSS date string as a compact relative time (e.g. "5m ago", "3h ago").
 *
 * @param iso - A date string from an RSS `<pubDate>`/`<published>` element.
 * @returns A short relative-time label, or "" when the date is missing/unparseable.
 */
function timeAgo(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/**
 * Live news headlines widget. Fetches a selectable public RSS feed through a free
 * CORS proxy, parses the XML in-browser with `DOMParser`, and lists the latest
 * headlines with relative timestamps. Includes source tabs, refresh, and a retry
 * on failure. The chosen feed persists in localStorage.
 *
 * The sources themselves are the user's: the built-in list is only a starting
 * point, and any of it can be removed or added to from the panel's own manage
 * view (see `lib/feeds.ts`). That list persists too, so the panel ends up showing
 * whichever corner of the news the user actually reads.
 *
 * Each feed is cached separately (see {@link useCachedResource}), so flicking
 * between the source tabs re-reads a feed you already loaded instead of clearing
 * the list and fetching it again.
 */
export default function NewsWidget() {
  const [stored, setStored] = useLocalStorage<Feed[]>('news.sources', BUILT_IN_FEEDS);
  const [feedId, setFeedId] = useLocalStorage<string>('news.feed', BUILT_IN_FEEDS[0].id);
  const [manageOpen, setManageOpen] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [error, setError] = useState('');

  const feeds = normalizeFeeds(stored);
  // A saved tab can name a source that has since been removed; fall through to
  // whatever is left rather than showing nothing.
  const feed = feeds.find((f) => f.id === feedId) ?? feeds[0] ?? null;
  // With no sources at all there is nothing to show but the manage view, so it
  // is not something the user has to go and find.
  const managing = manageOpen || feeds.length === 0;

  const addSource = (e: FormEvent) => {
    e.preventDefault();
    const added = makeFeed(draftLabel, draftUrl);
    if (!added) {
      setError('That doesn’t look like a feed address. Try https://example.com/rss.xml');
      return;
    }
    if (feeds.some((f) => f.url === added.url)) {
      setError('That source is already in the list.');
      return;
    }
    setStored(addFeed(feeds, added));
    setFeedId(added.id);
    setDraftLabel('');
    setDraftUrl('');
    setError('');
  };

  const removeSource = (id: string) => {
    const next = removeFeed(feeds, id);
    setStored(next);
    if (id === feed?.id) setFeedId(next[0]?.id ?? '');
  };

  const restore = () => {
    setStored(BUILT_IN_FEEDS);
    setFeedId(BUILT_IN_FEEDS[0].id);
    setError('');
  };

  const fetchFeed = async (): Promise<Article[]> => {
    // Nothing to fetch until there is a source; the manage view is on screen.
    if (!feed) return [];
    const res = await fetch(PROXY + encodeURIComponent(feed.url));
    if (!res.ok) throw new Error('bad response');
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const items = Array.from(doc.querySelectorAll('item, entry')).slice(0, 8);
    const parsed: Article[] = items.map((item) => {
      const link =
        item.querySelector('link')?.textContent?.trim() ||
        item.querySelector('link')?.getAttribute('href') ||
        '#';
      return {
        title: item.querySelector('title')?.textContent?.trim() ?? 'Untitled',
        link,
        date:
          item.querySelector('pubDate')?.textContent?.trim() ||
          item.querySelector('published, updated')?.textContent?.trim() ||
          '',
      };
    });
    // An empty parse is a failed fetch dressed up as success (a proxy error page
    // parses fine and yields nothing) — don't cache it.
    if (parsed.length === 0) throw new Error('empty');
    return parsed;
  };

  const {
    data: articles,
    status,
    revalidating,
    refresh,
  } = useCachedResource<Article[]>(feed ? `news:${feed.url}` : 'news:none', TTL, fetchFeed);

  return (
    <Widget
      title="News"
      className={styles.container}
      // Eight headlines and a row of source tabs, in a card that fits about
      // four of them — this is the panel with the most to gain from the room.
      expandable
      action={
        <>
          <button
            className={styles.manage}
            onClick={() => setManageOpen((open) => !open)}
            aria-expanded={managing}
            title={managing ? 'Done' : 'Manage sources'}
            aria-label={managing ? 'Done managing sources' : 'Manage sources'}
          >
            <Icon name={managing ? 'check' : 'settings'} />
          </button>
          <button
            className={styles.refresh}
            onClick={refresh}
            disabled={revalidating || !feed}
            title={revalidating ? 'Refreshing…' : 'Refresh'}
            aria-label="Refresh"
          >
            <Icon name="refresh" />
          </button>
        </>
      }
    >
      {managing ? (
        <div className={styles.sources}>
          {feeds.length === 0 ? (
            <p>No sources yet. Add one below to start reading.</p>
          ) : (
            <ul>
              {feeds.map((f) => (
                <li key={f.id}>
                  <span>{f.label}</span>
                  <span>{hostOf(f.url)}</span>
                  <button
                    className={styles.drop}
                    onClick={() => removeSource(f.id)}
                    title={`Remove ${f.label}`}
                    aria-label={`Remove ${f.label}`}
                  >
                    <Icon name="close" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={addSource}>
            <input
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              placeholder="Name (optional)"
              aria-label="Source name"
            />
            <input
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="RSS or Atom feed URL"
              aria-label="Feed URL"
            />
            <button className={styles.add} type="submit">
              <Icon name="plus" /> Add
            </button>
          </form>

          {error && <p role="alert">{error}</p>}

          {!isDefaultFeeds(feeds) && (
            <button className={styles.restore} onClick={restore}>
              Restore the default sources
            </button>
          )}
        </div>
      ) : (
        <>
          <div className={styles.tabs}>
            {feeds.map((f) => (
              <button
                key={f.id}
                className={`${styles.tab}${f.id === feed?.id ? ` ${styles.isActive}` : ''}`}
                aria-pressed={f.id === feed?.id}
                onClick={() => setFeedId(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          {status === 'loading' && (
            <div className={styles.skeleton} role="status" aria-label="Loading headlines">
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row}>
                  <span className={styles.bar} />
                  <span className={styles.bar} />
                </div>
              ))}
            </div>
          )}
          {status === 'error' && (
            <p>
              Couldn't load this feed.{' '}
              <button className={styles.retry} onClick={refresh}>
                Retry
              </button>
            </p>
          )}
          {status === 'ready' && articles && (
            <ul className={styles.list}>
              {articles.map((a, i) => (
                <li key={i}>
                  <a href={a.link} target="_blank" rel="noreferrer">
                    {a.title}
                  </a>
                  {a.date && <span>{timeAgo(a.date)}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Widget>
  );
}
