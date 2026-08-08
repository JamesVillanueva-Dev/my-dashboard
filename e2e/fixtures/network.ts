import type { Page, Route } from '@playwright/test';

/**
 * Canned answers for every external service the dashboard talks to, and a
 * tripwire for the ones it is not supposed to.
 *
 * The tripwire is the point. A spec that reaches the real internet passes on a
 * machine with network and hangs on one without, and the failure looks like
 * flake rather than like the missing rule it is — so anything unrouted is
 * recorded and fails the test at teardown (see `test.ts`).
 */

/** A service with a canned response, addressable from a spec that wants it to fail. */
export type Service =
  | 'weather'
  | 'geocode'
  | 'news'
  | 'favicon'
  | 'youtube'
  | 'google'
  | 'spotify';

/** Handle to the routing installed on a page. */
export interface NetworkStub {
  /**
   * External requests that matched no rule, in the order they arrived. Empty is
   * the only acceptable value; the extended `test` asserts it.
   */
  readonly unstubbed: string[];
  /** How many requests each service has answered, for the cache specs. */
  readonly counts: Record<Service, number>;
  /** Answer `service` with a 500 until {@link recover} is called. */
  fail(service: Service): void;
  /** Go back to answering `service` normally. */
  recover(service: Service): void;
  /**
   * Drop every external request, the way a lost connection does.
   *
   * Deliberately an abort rather than `context.setOffline(true)`: a fulfilled
   * route never reaches the network stack, so the browser's offline flag would
   * have nothing to act on here and the panels would keep loading happily.
   * `ERR_INTERNET_DISCONNECTED` is what `fetch` actually sees when the machine
   * has no network.
   */
  disconnect(): void;
  /** Put the connection back. */
  reconnect(): void;
}

/** Matches each service by host and path, in the order rules are tried. */
const RULES: [Service, RegExp][] = [
  ['weather', /^https:\/\/api\.open-meteo\.com\/v1\/forecast/],
  ['geocode', /^https:\/\/geocoding-api\.open-meteo\.com\//],
  ['news', /^https:\/\/api\.allorigins\.win\//],
  ['favicon', /^https:\/\/www\.google\.com\/s2\/favicons/],
  ['youtube', /^https:\/\/(www\.youtube\.com|www\.youtube-nocookie\.com|i\.ytimg\.com)\//],
  ['google', /^https:\/\/(accounts\.google\.com|[a-z]*\.?googleapis\.com)\//],
  ['spotify', /^https:\/\/(accounts\.spotify\.com|api\.spotify\.com|sdk\.scdn\.co|open\.spotify\.com)\//],
];

/**
 * A five-day forecast whose numbers are fixed, so a spec can assert on the
 * temperature it renders. Dates are relative to the pinned clock's day.
 */
function forecast(url: string): string {
  const unit = /temperature_unit=celsius/.test(url) ? 'celsius' : 'fahrenheit';
  const base = unit === 'celsius' ? 18 : 64;
  const days = [0, 1, 2, 3, 4].map((offset) => {
    const d = new Date(Date.UTC(2026, 2, 17) + offset * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
  return JSON.stringify({
    current: {
      temperature_2m: base,
      relative_humidity_2m: 55,
      apparent_temperature: base - 2,
      weather_code: 0,
      wind_speed_10m: 7,
    },
    daily: {
      time: days,
      weather_code: [0, 2, 3, 61, 0],
      temperature_2m_max: days.map((_, i) => base + 4 + i),
      temperature_2m_min: days.map((_, i) => base - 8 + i),
    },
  });
}

/** Two cities, enough for the search path without reaching Open-Meteo. */
const GEOCODE = JSON.stringify({
  results: [
    { name: 'Berlin', admin1: 'Berlin', country_code: 'DE', latitude: 52.52, longitude: 13.405 },
    { name: 'Bern', admin1: 'Bern', country_code: 'CH', latitude: 46.948, longitude: 7.447 },
  ],
});

/** An RSS document with headlines a spec can point at by name. */
const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Stubbed feed</title>
  <item>
    <title>Stubbed headline one</title>
    <link>https://example.com/one</link>
    <pubDate>Tue, 17 Mar 2026 09:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Stubbed headline two</title>
    <link>https://example.com/two</link>
    <pubDate>Tue, 17 Mar 2026 08:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Stubbed headline three</title>
    <link>https://example.com/three</link>
    <pubDate>Tue, 17 Mar 2026 07:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

/** A 1×1 transparent GIF, for the favicon service and the thumbnail host. */
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

/**
 * Enough of YouTube's IFrame Player API to satisfy `useYouTubePlaylist`.
 *
 * It loads the real script into a `<script>` tag, so anything that is not valid
 * JavaScript surfaces as an uncaught parse error rather than as a missing
 * feature — and the hook rejects if the ready callback fires without a global.
 * The player it installs reports no playlist, which is the state the widget is
 * in when nothing has loaded. Actual playback is out of scope (see the manual
 * checklist), so there is nothing more here to pretend at.
 */
const IFRAME_API = `
window.YT = {
  Player: function () {
    return {
      getPlaylist: function () { return null; },
      getPlaylistIndex: function () { return -1; },
      getVideoData: function () { return undefined; },
      playVideoAt: function () {},
      getCurrentTime: function () { return 0; },
      getPlayerState: function () { return -1; },
      seekTo: function () {},
      playVideo: function () {}
    };
  }
};
if (typeof window.onYouTubeIframeAPIReady === 'function') window.onYouTubeIframeAPIReady();
`;

/** Answers one service. */
function respond(service: Service, route: Route, url: string): Promise<void> {
  const json = (body: string) =>
    route.fulfill({ status: 200, contentType: 'application/json', body });

  switch (service) {
    case 'weather':
      return json(forecast(url));
    case 'geocode':
      return json(GEOCODE);
    case 'news':
      return route.fulfill({ status: 200, contentType: 'text/xml', body: RSS });
    case 'favicon':
      return route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL });
    case 'youtube':
      // Four different things come off these hosts, and serving the wrong shape
      // for any of them is a console error rather than a quiet miss.
      if (/\/iframe_api/.test(url)) {
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: IFRAME_API });
      }
      if (/^https:\/\/i\.ytimg\.com\//.test(url)) {
        return route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL });
      }
      if (/oembed/.test(url)) return json(JSON.stringify({ title: 'Stubbed playlist' }));
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>embed</title>',
      });
    case 'spotify':
      if (/\.js(\?|$)/.test(url)) {
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      }
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    case 'google':
      // Nothing is connected in the signed-out app, so any call here is a bug
      // in the spec rather than a path worth stubbing convincingly.
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
  }
}

/**
 * Installs the canned answers on `page`.
 *
 * Same-origin requests (the app's own modules and assets) are passed straight
 * through; everything else must match a rule or it is recorded and aborted.
 *
 * @param page - The page to route. Call before `page.goto`.
 * @returns A handle for making a service fail, and the unstubbed-request log.
 */
export async function stubNetwork(page: Page): Promise<NetworkStub> {
  const unstubbed: string[] = [];
  const counts = {
    weather: 0,
    geocode: 0,
    news: 0,
    favicon: 0,
    youtube: 0,
    google: 0,
    spotify: 0,
  } satisfies Record<Service, number>;
  const failing = new Set<Service>();
  let offline = false;

  await page.route('**/*', async (route) => {
    const url = route.request().url();

    // The app itself, plus anything the browser resolves without a network hop.
    if (/^(data|blob|about):/.test(url) || url.startsWith('http://localhost:')) {
      return route.continue();
    }

    const rule = RULES.find(([, pattern]) => pattern.test(url));
    if (!rule) {
      unstubbed.push(url);
      return route.abort('failed');
    }

    const [service] = rule;
    counts[service] += 1;
    if (offline) return route.abort('internetdisconnected');
    if (failing.has(service)) {
      return route.fulfill({ status: 500, contentType: 'text/plain', body: 'stubbed failure' });
    }
    return respond(service, route, url);
  });

  return {
    unstubbed,
    counts,
    fail: (service) => failing.add(service),
    recover: (service) => failing.delete(service),
    disconnect: () => {
      offline = true;
    },
    reconnect: () => {
      offline = false;
    },
  };
}
