import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_FEEDS,
  addFeed,
  hostOf,
  isDefaultFeeds,
  makeFeed,
  normalizeFeeds,
  removeFeed,
  type Feed,
} from './feeds';

const feed = (over: Partial<Feed> = {}): Feed => ({
  id: 'custom:https://example.com/rss.xml',
  label: 'Example',
  url: 'https://example.com/rss.xml',
  ...over,
});

describe('BUILT_IN_FEEDS', () => {
  it('has unique ids and urls — both address a source on their own', () => {
    expect(new Set(BUILT_IN_FEEDS.map((f) => f.id)).size).toBe(BUILT_IN_FEEDS.length);
    expect(new Set(BUILT_IN_FEEDS.map((f) => f.url)).size).toBe(BUILT_IN_FEEDS.length);
  });

  it('survives its own normalisation, so the shipped list is never repaired', () => {
    expect(normalizeFeeds(BUILT_IN_FEEDS)).toEqual(BUILT_IN_FEEDS);
  });
});

describe('hostOf', () => {
  it('names a source by its host, without the noise', () => {
    expect(hostOf('https://www.theverge.com/rss/index.xml')).toBe('theverge.com');
  });

  it('gives back an unparseable address as-is rather than nothing', () => {
    expect(hostOf('not a url')).toBe('not a url');
  });
});

describe('makeFeed', () => {
  it('builds a source from a label and a URL', () => {
    expect(makeFeed('Verge', 'https://theverge.com/rss')).toEqual({
      id: 'custom:https://theverge.com/rss',
      label: 'Verge',
      url: 'https://theverge.com/rss',
    });
  });

  it('fills in a missing scheme, which is how people type a URL', () => {
    expect(makeFeed('', 'theverge.com/rss')?.url).toBe('https://theverge.com/rss');
  });

  it('falls back to the host when no name is given', () => {
    expect(makeFeed('   ', 'https://www.theverge.com/rss')?.label).toBe('theverge.com');
  });

  it('rejects an address that is not http(s)', () => {
    // A source is fetched, so a scheme that is not a fetchable one is not a
    // source — and `javascript:` in particular must never be rewritten to https.
    expect(makeFeed('Bad', 'javascript:alert(1)')).toBeNull();
    expect(makeFeed('Bad', 'ftp://example.com/rss')).toBeNull();
    expect(makeFeed('Bad', '   ')).toBeNull();
  });

  it('gives two sources at the same URL the same id, so neither can be added twice', () => {
    expect(makeFeed('One', 'https://example.com/rss')?.id).toBe(
      makeFeed('Another name', 'https://example.com/rss')?.id,
    );
  });
});

describe('addFeed', () => {
  it('appends a new source', () => {
    expect(addFeed([], feed())).toEqual([feed()]);
  });

  it('ignores a source already in the list, even under a different name', () => {
    const list = [feed()];
    expect(addFeed(list, feed({ id: 'other', label: 'Renamed' }))).toBe(list);
  });
});

describe('removeFeed', () => {
  it('drops the named source and leaves the rest', () => {
    expect(removeFeed(BUILT_IN_FEEDS, 'npr').map((f) => f.id)).toEqual([
      'bbc-top',
      'bbc-world',
      'bbc-tech',
      'hn',
    ]);
  });

  it('can empty the list — removing every source is allowed', () => {
    expect(BUILT_IN_FEEDS.reduce((list, f) => removeFeed(list, f.id), BUILT_IN_FEEDS)).toEqual([]);
  });
});

describe('isDefaultFeeds', () => {
  it('recognises the untouched list', () => {
    expect(isDefaultFeeds(BUILT_IN_FEEDS)).toBe(true);
  });

  it('recognises an edited one', () => {
    expect(isDefaultFeeds(removeFeed(BUILT_IN_FEEDS, 'npr'))).toBe(false);
    expect(isDefaultFeeds(addFeed(BUILT_IN_FEEDS, feed()))).toBe(false);
  });
});

describe('normalizeFeeds', () => {
  it('falls back to the built-ins when nothing usable is stored', () => {
    expect(normalizeFeeds(undefined)).toEqual(BUILT_IN_FEEDS);
    expect(normalizeFeeds('bbc-top')).toEqual(BUILT_IN_FEEDS);
  });

  it('keeps an empty list, since removing every source is a real choice', () => {
    expect(normalizeFeeds([])).toEqual([]);
  });

  it('drops entries that could not be rendered or fetched', () => {
    expect(
      normalizeFeeds([
        feed(),
        null,
        'bbc-top',
        { id: 'no-url' },
        { id: 'bad-scheme', label: 'Bad', url: 'javascript:alert(1)' },
        { label: 'No id', url: 'https://example.org/rss' },
      ]),
    ).toEqual([feed()]);
  });

  it('drops a duplicate of either address, which would otherwise be ambiguous', () => {
    expect(
      normalizeFeeds([
        feed(),
        feed({ id: 'same-url-different-id' }),
        feed({ url: 'https://elsewhere.com/rss' }),
      ]),
    ).toEqual([feed()]);
  });

  it('names an unnamed source after its host', () => {
    expect(normalizeFeeds([feed({ label: '  ' })])[0].label).toBe('example.com');
  });
});
