/**
 * The news panel's sources: the list it ships with, and the rules for the list
 * once the user has edited it.
 *
 * Sources are stored whole rather than as ids into a catalogue (the way `layout`
 * references `registry`), because a source the user typed in has no catalogue
 * entry to point at. That makes the persisted list the single source of truth,
 * so {@link normalizeFeeds} has to be able to repair anything it finds there.
 */

/** One news source the panel can show. */
export interface Feed {
  /** Stable id, persisted in the saved source list and in the active-tab setting. */
  id: string;
  /** Short label shown on the source tab. */
  label: string;
  /** The RSS or Atom URL, fetched through the CORS proxy. */
  url: string;
}

/**
 * The sources the panel ships with. All public RSS feeds, and all removable —
 * this is the starting list, not a fixed one.
 */
export const BUILT_IN_FEEDS: Feed[] = [
  { id: 'bbc-top', label: 'BBC Top', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { id: 'bbc-world', label: 'World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'bbc-tech', label: 'Tech', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { id: 'npr', label: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  { id: 'hn', label: 'Hacker News', url: 'https://hnrss.org/frontpage' },
];

/** The only schemes a source may use. Anything else is not a feed to fetch. */
const PROTOCOLS = ['http:', 'https:'];

/**
 * Parses a feed address the user typed.
 *
 * @param raw - The address as entered, with any surrounding whitespace.
 * @returns The parsed URL, or `null` when it is not a usable http(s) address.
 */
function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Leaving the scheme off ("example.com/rss") is the common way to type a URL,
  // so fill one in — but only when none was given at all, so that an explicit
  // `javascript:` is rejected below rather than quietly rewritten into a fetch.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return PROTOCOLS.includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

/**
 * A source's host, for naming and labelling it — `www.` dropped, since it says
 * nothing about which source this is.
 *
 * @param url - A feed URL.
 * @returns The bare hostname, or the input unchanged if it cannot be parsed.
 */
export function hostOf(url: string): string {
  return parseUrl(url)?.hostname.replace(/^www\./, '') ?? url;
}

/**
 * Builds a source from what the user typed into the add form.
 *
 * @param label - The name they gave it; blank falls back to the feed's host.
 * @param url - The feed address.
 * @returns The new source, or `null` when the address is not a usable http(s) URL.
 */
export function makeFeed(label: string, url: string): Feed | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  return {
    // The URL is what makes a source unique, so it is also what makes the id
    // unique: two added sources cannot collide, and the id survives a rename.
    id: `custom:${parsed.href}`,
    label: label.trim() || hostOf(parsed.href),
    url: parsed.href,
  };
}

/**
 * Appends a source, ignoring one that is already in the list.
 *
 * @returns The new list, or the original when `feed` was already present.
 */
export function addFeed(feeds: Feed[], feed: Feed): Feed[] {
  return feeds.some((f) => f.url === feed.url) ? feeds : [...feeds, feed];
}

/** Drops the source with `id`, if it is there. */
export function removeFeed(feeds: Feed[], id: string): Feed[] {
  return feeds.filter((f) => f.id !== id);
}

/** Whether the list is untouched, which is what decides if "restore" is offered. */
export function isDefaultFeeds(feeds: Feed[]): boolean {
  return (
    feeds.length === BUILT_IN_FEEDS.length &&
    feeds.every((f, i) => f.id === BUILT_IN_FEEDS[i].id && f.url === BUILT_IN_FEEDS[i].url)
  );
}

/**
 * Validates the persisted source list, dropping entries that are no longer
 * usable and normalising the ones that are.
 *
 * An empty list is a real answer — the user can remove every source — so only a
 * value that is not a list at all falls back to the built-ins.
 *
 * @param stored - The raw persisted value.
 * @returns A list safe to render and fetch from.
 */
export function normalizeFeeds(stored: unknown): Feed[] {
  if (!Array.isArray(stored)) return BUILT_IN_FEEDS;

  const feeds: Feed[] = [];
  for (const entry of stored) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, label, url } = entry as Partial<Feed>;
    if (typeof id !== 'string' || !id || typeof url !== 'string') continue;

    const parsed = parseUrl(url);
    if (!parsed) continue;
    // Both fields address a source on their own — the id from the saved tab, the
    // URL from the cache key — so a duplicate of either would be ambiguous.
    if (feeds.some((f) => f.id === id || f.url === parsed.href)) continue;

    feeds.push({
      id,
      label: typeof label === 'string' && label.trim() ? label.trim() : hostOf(parsed.href),
      url: parsed.href,
    });
  }
  return feeds;
}
