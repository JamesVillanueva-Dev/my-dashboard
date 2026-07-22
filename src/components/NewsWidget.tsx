import { useState, useEffect, useCallback } from 'react';
import Widget from './Widget';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface Feed {
  id: string;
  label: string;
  url: string;
}

// Public RSS feeds. Fetched through a free CORS proxy and parsed in-browser.
const FEEDS: Feed[] = [
  { id: 'bbc-top', label: 'BBC Top', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { id: 'bbc-world', label: 'World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'bbc-tech', label: 'Tech', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { id: 'npr', label: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  { id: 'hn', label: 'Hacker News', url: 'https://hnrss.org/frontpage' },
];

const PROXY = 'https://api.allorigins.win/raw?url=';

interface Article {
  title: string;
  link: string;
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
 */
export default function NewsWidget() {
  const [feedId, setFeedId] = useLocalStorage<string>('news.feed', FEEDS[0].id);
  const [articles, setArticles] = useState<Article[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const feed = FEEDS.find((f) => f.id === feedId) ?? FEEDS[0];

  const load = useCallback(async () => {
    setStatus('loading');
    try {
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
      if (parsed.length === 0) throw new Error('empty');
      setArticles(parsed);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [feed.url]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Widget
      title="News"
      action={
        <button className="pill" onClick={load} title="Refresh">
          ↻
        </button>
      }
    >
      <div className="news__tabs">
        {FEEDS.map((f) => (
          <button
            key={f.id}
            className={`news__tab${f.id === feedId ? ' is-active' : ''}`}
            onClick={() => setFeedId(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {status === 'loading' && <p className="muted">Loading headlines…</p>}
      {status === 'error' && (
        <p className="muted">
          Couldn't load this feed.{' '}
          <button className="link" onClick={load}>
            Retry
          </button>
        </p>
      )}
      {status === 'ready' && (
        <ul className="news__list">
          {articles.map((a, i) => (
            <li key={i}>
              <a href={a.link} target="_blank" rel="noreferrer">
                {a.title}
              </a>
              {a.date && <span className="news__time">{timeAgo(a.date)}</span>}
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
