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

const feed = (overrides: Partial<Feed> = {}): Feed => ({
  id: 'custom:https://example.com/rss.xml',
  label: 'Example',
  url: 'https://example.com/rss.xml',
  ...overrides,
});

const idsOf = (feeds: readonly Feed[]) => feeds.map((each) => each.id);

describe('BUILT_IN_FEEDS', () => {
  it('gives every shipped source a unique id and url', () => {
    // Either one addresses a source on its own.
    expect(new Set(idsOf(BUILT_IN_FEEDS)).size).toBe(BUILT_IN_FEEDS.length);
    expect(new Set(BUILT_IN_FEEDS.map((each) => each.url)).size).toBe(BUILT_IN_FEEDS.length);
  });

  it('survives its own normalisation, so the shipped list is never repaired', () => {
    expect(normalizeFeeds(BUILT_IN_FEEDS)).toEqual(BUILT_IN_FEEDS);
  });
});

describe('hostOf', () => {
  it('names a source by its host, without the www prefix', () => {
    expect(hostOf('https://www.theverge.com/rss/index.xml')).toBe('theverge.com');
  });

  it('returns an unparseable address unchanged rather than nothing', () => {
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

  it('rejects a scheme that cannot be fetched', () => {
    // `javascript:` in particular must never be rewritten to https.
    expect(makeFeed('Bad', 'javascript:alert(1)')).toBeNull();
    expect(makeFeed('Bad', 'ftp://example.com/rss')).toBeNull();
  });

  it('rejects a blank address', () => {
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
    const feeds = [feed()];

    expect(addFeed(feeds, feed({ id: 'other', label: 'Renamed' }))).toBe(feeds);
  });
});

describe('removeFeed', () => {
  it('drops the named source and leaves the rest', () => {
    expect(idsOf(removeFeed(BUILT_IN_FEEDS, 'npr'))).toEqual([
      'bbc-top',
      'bbc-world',
      'bbc-tech',
      'hn',
    ]);
  });

  it('can empty the list — removing every source is allowed', () => {
    const emptied = BUILT_IN_FEEDS.reduce(
      (feeds, each) => removeFeed(feeds, each.id),
      BUILT_IN_FEEDS,
    );

    expect(emptied).toEqual([]);
  });
});

describe('isDefaultFeeds', () => {
  it('is true for the untouched list', () => {
    expect(isDefaultFeeds(BUILT_IN_FEEDS)).toBe(true);
  });

  it('is false once a source has been removed', () => {
    expect(isDefaultFeeds(removeFeed(BUILT_IN_FEEDS, 'npr'))).toBe(false);
  });

  it('is false once a source has been added', () => {
    expect(isDefaultFeeds(addFeed(BUILT_IN_FEEDS, feed()))).toBe(false);
  });
});

describe('normalizeFeeds', () => {
  it('falls back to the built-ins when nothing is stored', () => {
    expect(normalizeFeeds(undefined)).toEqual(BUILT_IN_FEEDS);
  });

  it('falls back to the built-ins when the stored value is not a list', () => {
    expect(normalizeFeeds('bbc-top')).toEqual(BUILT_IN_FEEDS);
  });

  it('keeps an empty list, since removing every source is a real choice', () => {
    expect(normalizeFeeds([])).toEqual([]);
  });

  it('drops entries that could not be rendered or fetched', () => {
    const stored = [
      feed(),
      null,
      'bbc-top',
      { id: 'no-url' },
      { id: 'bad-scheme', label: 'Bad', url: 'javascript:alert(1)' },
      { label: 'No id', url: 'https://example.org/rss' },
    ];

    expect(normalizeFeeds(stored)).toEqual([feed()]);
  });

  it('drops a duplicate of either address, which would otherwise be ambiguous', () => {
    const stored = [
      feed(),
      feed({ id: 'same-url-different-id' }),
      feed({ url: 'https://elsewhere.com/rss' }),
    ];

    expect(normalizeFeeds(stored)).toEqual([feed()]);
  });

  it('names an unnamed source after its host', () => {
    expect(normalizeFeeds([feed({ label: '  ' })])[0].label).toBe('example.com');
  });
});
