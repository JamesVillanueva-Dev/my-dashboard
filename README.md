# Dashboard

A personal start-page dashboard: weather, news, reminders (with optional Google
Calendar sync), to-dos, notes, quick links, a daily focus, and an embedded
Spotify player. Everything runs client-side — there is no backend, and your data
stays in your browser's `localStorage`. Sign-in (via Clerk) and Google Calendar
sync are both optional and off until you configure them.

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

Note that Clerk authenticates you; it does **not** sync your data. Signing in on a
different device gives you an empty dashboard, because widgets still read from that
browser's `localStorage`.

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
│   └── useCalendarSync.ts    drives the optional Google Calendar sync
├── lib/
│   ├── registry.tsx          catalogue of available widgets
│   ├── gcalSync.ts           Google Calendar reconciliation
│   ├── googleAuth.ts         in-memory OAuth token handling
│   └── clerkAuth.ts          Clerk key + "is auth enabled?" check
└── components/
    ├── Dashboard/            the grid: layout, drag-to-reorder, footer
    ├── AuthGate/             optional Clerk sign-in gate + storage scope
    ├── Header/               greeting, clock, theme toggle
    ├── UserMenu/             Clerk avatar menu (hidden when auth is off)
    ├── WidgetMenu/           enable/disable widgets
    ├── Widget/               card shell every widget renders into (+ chrome.ts)
    ├── ThemeToggle/
    ├── LegalModal/
    ├── FocusWidget/
    ├── WeatherWidget/
    ├── RemindersWidget/
    ├── TodoWidget/
    ├── NewsWidget/
    ├── NotesWidget/
    ├── QuickLinksWidget/
    └── SpotifyWidget/
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
- [User stories](docs/user-stories.md) · [Wireframes](docs/wireframes.md)
