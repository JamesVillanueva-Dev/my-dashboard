# Dashboard

A personal dashboard for running your day. It leads with a **Today** zone — what
is happening next, your one focus for the day, and a single timeline merging
calendar events with your dated tasks — above a grid of panels: tasks (with
optional Google Calendar sync), calendar, weather, news, notes, and an embedded
YouTube music player. (A Spotify panel ships too, off by default — switch it on
from the **Widgets** menu.) Your bookmark shortcuts live in the nav bar, always
in reach.
Everything runs client-side — there is no backend,
and your data stays in your browser's `localStorage`. Sign-in (via Clerk) and
Google Calendar sync are both optional and off until you configure them.

Panels can be reordered by dragging their handle or, from the keyboard, by
focusing a handle and pressing the arrow keys.

React + TypeScript + Vite, tested with Vitest and Testing Library.

## Getting started

```bash
npm install
npm run dev
```

| Script                     | What it does                                  |
| -------------------------- | --------------------------------------------- |
| `npm run dev`              | Vite dev server with HMR                      |
| `npm run build`            | Typecheck (`tsc -b`) then production build     |
| `npm run preview`          | Serve the production build locally            |
| `npm test`                 | Vitest in watch mode                          |
| `npm run test:run`         | Vitest once (CI)                              |
| `npm run lint`             | ESLint                                        |
| `npm run create:component` | Scaffold a new component folder               |

Google Calendar sync is optional and off unless a `VITE_GOOGLE_CLIENT_ID` is set
in `.env.local` — see [ADR 0002](docs/adr/0002-google-calendar-integration.md).

### Optional: sign-in with Clerk

Authentication is off by default; the dashboard runs with no account, as it always
has. To put it behind a sign-in, create a Clerk application and add its publishable
key to `.env.local`:

```bash
# .env.local
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxx
```

With the key set, visitors get a sign-in screen and each account's widgets, notes,
and reminders are stored under its own `localStorage` namespace, so two people
sharing a browser don't see each other's dashboards. The first account to sign in
inherits any data saved before auth was switched on. Sign out from the avatar menu
in the header. See [ADR 0003](docs/adr/0003-clerk-authentication.md).

Signing in also **restores your dashboard**. Theme, tasks, notes, quick links,
your name, and your saved music sources are mirrored into your Clerk account,
pulled down before the page paints and pushed back as you change things. Sign in
on a new device — or in a browser that clears site data on exit — and your
dashboard comes with you. Still no backend: Clerk's user metadata is written
straight from the browser. See [ADR 0008](docs/adr/0008-account-synced-dashboard-state.md).

**Layout is kept separately for desktop and mobile.** Panel order, widget sizes,
and the daily-focus toggle are saved per device shape, so a three-column desktop
arrangement and a phone layout never overwrite each other. Everything else is
shared — a note written on your phone is on your PC. A device counts as mobile if
it has a touch-first pointer, so resizing a desktop window narrow won't switch you
into the phone's layout.

Two limits worth knowing:

- Clerk caps account metadata at **8KB**. That is roomy for preferences and tight
  for prose, so a very long Notes panel can outgrow it. When that happens the
  dashboard says so and names the offending panel — it never silently drops data,
  and everything keeps working locally.
- Conflicts are **last-write-wins**. Edit the same dashboard on two devices while
  one is offline and the older set of changes is lost.

Cached weather and headlines stay local (they're refetchable), as does the Google
Calendar sync cursor — that one tracks what *this browser* has already seen, so
copying it to another device would make it skip events.

Without a Clerk key there is no account, and the dashboard runs entirely from
`localStorage` exactly as before.

### Music: YouTube by default, Spotify opt-in

The **YouTube** panel is the music player a fresh dashboard shows. Paste any
YouTube link — a video, a playlist, a live radio stream, a `music.youtube.com`
link — and it plays in the embedded player, volume and all, with no account and
no configuration. Sources are saved as tabs in `localStorage`.

The **Spotify** panel is off by default; add it from the **Widgets** menu. It is
kept because its opt-in mode is genuinely better for Premium subscribers, but its
zero-setup mode serves 30-second previews to a signed-out browser, which is a
poor default. See [ADR 0007](docs/adr/0007-youtube-as-the-default-music-panel.md).

#### Optional: in-page Spotify player

The Spotify panel uses Spotify's iframe embed by default, which works with no
setup but cannot be volume-controlled — a cross-origin frame is closed to the
host page, and Spotify's iFrame API exposes no volume method.

Setting a `VITE_SPOTIFY_CLIENT_ID` swaps in a real Web Playback SDK device with
its own volume slider and transport controls:

```bash
# .env.local
VITE_SPOTIFY_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
and register every redirect URI you use — Spotify matches them exactly, so local
dev and the deployed site each need their own entry.

This needs **Spotify Premium**; Spotify does not allow in-page playback on free
accounts. Without a key, without connecting, or on a free account, the panel
keeps the embedded player. See [ADR 0006](docs/adr/0006-spotify-in-page-player.md).

## Project structure

Every component lives in one flat `src/components/` directory, each in its own
folder holding `index.tsx`, `styles.module.css`, and `index.test.tsx`.

```
src/
├── main.tsx                  mounts <AuthGate><Dashboard>
├── styles.css                the ONLY global stylesheet (tokens + resets)
├── styles/
│   └── controls.module.css   shared control primitives, pulled in via `composes`
├── hooks/
│   ├── useLocalStorage.ts    persistence + per-user key namespacing
│   ├── useCachedResource.ts  cached, refreshable network reads
│   ├── useCalendarSync.ts    drives the optional Google Calendar sync
│   ├── useTheme.ts           colour-scheme preference + data-theme/favicon
│   ├── useDismiss.ts         outside-click / Escape dismissal for popovers
│   ├── useSpotifyPlayer.ts   optional Web Playback SDK device + volume
│   └── useProfileSync.ts     pulls/pushes the dashboard to the Clerk account
├── lib/
│   ├── registry.tsx          catalogue of available widgets
│   ├── profileSync.ts        shared vs per-device keys, and conflict rules
│   ├── themes.ts             the colour schemes offered in settings
│   ├── spotifyAuth.ts        Spotify OAuth (PKCE), opt-in
│   ├── cache.ts              stale-while-revalidate store behind the hook above
│   ├── gcalSync.ts           Google Calendar reconciliation
│   ├── googleAuth.ts         in-memory OAuth token handling
│   └── clerkAuth.ts          Clerk key + "is auth enabled?" check
└── components/
    ├── Dashboard/            the grid: layout, drag-to-reorder
    ├── AuthGate/             optional Clerk sign-in gate + storage scope
    ├── Header/               clock, quick links, settings
    ├── QuickLinks/           bookmark shortcuts in the nav bar
    ├── Footer/               identity, source credits, legal links
    ├── UserMenu/             Clerk avatar menu (hidden when auth is off)
    ├── WidgetMenu/           enable/disable widgets
    ├── Widget/               card shell every widget renders into (+ chrome.ts)
    ├── Settings/             colour-scheme picker
    ├── LegalModal/
    ├── FocusWidget/
    ├── WeatherWidget/
    ├── RemindersWidget/
    ├── TodoWidget/
    ├── NewsWidget/
    ├── NotesWidget/
    ├── SpotifyWidget/
    └── YouTubeWidget/
```

Conventions — and the reasoning behind them — are documented in
[CLAUDE.md](CLAUDE.md).

## Adding a component

```bash
npm run create:component                    # prompts for the name
npm run create:component -- EventsCard
npm run create:component -- EventsCard --no-test
```

## Architecture decisions

- [ADR 0001 — Client-only dashboard architecture](docs/adr/0001-client-only-dashboard-architecture.md)
- [ADR 0002 — Google Calendar integration](docs/adr/0002-google-calendar-integration.md)
- [ADR 0003 — Clerk authentication and per-user local data](docs/adr/0003-clerk-authentication.md)
- [ADR 0006 — Opt-in Spotify in-page player](docs/adr/0006-spotify-in-page-player.md)
- [ADR 0007 — YouTube as the default music panel](docs/adr/0007-youtube-as-the-default-music-panel.md)
- [ADR 0008 — Account-synced dashboard state](docs/adr/0008-account-synced-dashboard-state.md)
- [User stories](docs/user-stories.md) · [Wireframes](docs/wireframes.md)
