# ADR 0001: Client-only dashboard architecture

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Project owner

## Context

We are building a personal dashboard that shows weather, news, notes, reminders,
and several productivity widgets (to-do, quick links, focus of the day). The
requested data sources vary in how they can be accessed from a web app:

- **Weather** — available from free, key-less, CORS-enabled APIs.
- **News** — available as public RSS feeds, but most feeds are not CORS-enabled
  and news JSON APIs require an API key.
- **Notes (Google Docs)** — requires Google OAuth and, realistically, a backend
  to hold tokens and proxy the Docs API.
- **Reminders / to-do / links / focus** — purely personal data with no external
  dependency.

The owner chose to start with a **browser-only app, live data where it's free and
local storage otherwise**, deferring Google integration to a later phase.

## Decision

1. **No backend.** Ship a static single-page app (Vite + React + TypeScript).
   There is no server, database, or auth layer.
2. **Persistence via `localStorage`.** All user data (notes, reminders, to-dos,
   quick links, focus, layout, name, theme, weather location/unit) is stored in
   the browser through a single `useLocalStorage` hook.
3. **Weather** uses **Open-Meteo** (forecast + geocoding). No API key, CORS-enabled.
4. **News** reads **public RSS feeds through a free CORS proxy**
   (`api.allorigins.win`) and parses the XML in-browser with `DOMParser`. Each
   feed has explicit loading/error/retry states because the proxy is best-effort.
5. **Google Docs / Calendar are out of scope for this phase** and documented as a
   follow-up requiring OAuth + a small backend.
6. **Layout is data.** The set and order of visible widgets is a persisted
   `string[]` of widget ids; a central registry (`src/widgets/registry.tsx`) maps
   ids to components. Widgets are enabled/disabled via a menu and reordered by
   drag-and-drop.
7. **Theming** ships two palettes (black & yellow default; purple/blue "dark").
   The OS `prefers-color-scheme` sets the initial value; a manual toggle writes
   `data-theme` on `<html>`, whose CSS-variable overrides win by specificity.

## Consequences

**Positive**

- Zero setup: `npm install && npm run dev` and it works — no keys, no accounts.
- Trivial hosting (any static host / GitHub Pages).
- Privacy: personal data never leaves the browser.
- The registry + persisted-layout design makes adding a widget a one-line change
  and made "movable/removable widgets" cheap to implement.

**Negative / risks**

- **Data is per-browser, not synced.** Clearing site data or switching devices
  loses everything. Acceptable for a personal v1; sync is a future ADR.
- **The news CORS proxy is a third-party dependency** that can rate-limit or go
  down. Mitigated with per-feed retry and multiple feeds; revisiting it (self-host
  a proxy, or a serverless function) is a known follow-up.
- **`localStorage` is synchronous and ~5 MB.** Fine for text-sized data here.
- **Deferring Google integration** means "notes" is a local scratchpad for now,
  not the user's real Google Docs.

## Alternatives considered

- **Add a backend now (Node/serverless) for OAuth + news.** Rejected for v1: much
  more setup and hosting cost for features the owner chose to defer.
- **Bring-your-own API keys via `.env`.** Rejected as the default because it
  pushes signup friction onto the user; can be added later per-widget.
- **A state/store library (Redux, Zustand) or a DnD library (dnd-kit).** Rejected
  as unnecessary at this size; React state + the native HTML Drag and Drop API
  keep the dependency footprint minimal.

## Follow-ups

- ADR 0002 (future): Google OAuth + Docs/Calendar integration and the backend it
  implies.
- ADR 0003 (future): cross-device sync strategy.
