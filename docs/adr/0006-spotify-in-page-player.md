# ADR 0006: An opt-in Spotify player, because the embed cannot be volume-controlled

- **Status:** Accepted
- **Date:** 2026-08-04
- **Deciders:** Project owner

## Context

The Spotify panel wraps Spotify's official iframe embed
(`https://open.spotify.com/embed/…`). That was the right call for a client-only
dashboard: it needs no account, no credentials, and no backend, so the panel
plays music the moment the dashboard is first opened (ADR 0001).

The request was a volume control. It cannot be built on the embed:

1. **The frame is cross-origin.** Same-origin policy blocks the host page from
   reaching the `<audio>`/`<video>` element inside it. There is nothing to set a
   volume on.
2. **The embed URL has no volume parameter.** Only `theme` and tracking params.
3. **Spotify's iFrame API has no volume method.** Its `EmbedController` exposes
   `loadEntity`, `loadUri`, `play`, `pause`, `resume`, `togglePlay`, `restart`,
   `seek`, `destroy`, and `addListener` — loading and transport only. A community
   request for embed volume control has been open since 2020 and is unimplemented.

So a slider wired to the embed would move and do nothing. The only API that
exposes `setVolume()` is the **Web Playback SDK**, which is a different thing
entirely: it turns the browser tab into a real Spotify Connect device. That
requires an OAuth token and a **Premium** account — Spotify does not permit
in-page playback on free accounts.

Adding that unconditionally would break the property that makes this dashboard
pleasant: it works with zero setup.

## Decision

**Ship the Web Playback SDK as a third opt-in integration, with the embed as the
permanent fallback.** This mirrors ADR 0002 (Google Calendar) and ADR 0003
(Clerk): the feature is invisible until an environment variable is set.

1. **Gated on `VITE_SPOTIFY_CLIENT_ID`.** Unset — the default, and what the
   repository ships — means `useSpotifyPlayer` returns `status: 'off'`
   immediately, no script is fetched, and the panel renders exactly as before.
2. **Authorization Code with PKCE**, not implicit. Spotify removed implicit
   grant support, and PKCE is the flow designed for public clients: no client
   secret, which matters because anything `VITE_`-prefixed is inlined into the
   browser bundle and would be published rather than protected.
3. **Tokens live in `sessionStorage`.** `googleAuth.ts` keeps its token purely
   in memory, which is stricter, but that is only possible because the GIS token
   flow never leaves the page. A redirect flow navigates away and back, so an
   in-memory token cannot survive the round trip that creates it.
   `sessionStorage` is the narrowest store that does: it survives the redirect
   and reloads within the tab, and is dropped when the tab closes — so a shared
   browser leaves no Spotify session behind. Deliberately **not**
   `localStorage`, which would outlive the session and sit beside the
   dashboard's own persisted data.
4. **Fall back to the embed on every failure.** Not configured, not connected,
   not Premium, SDK failed to load — each lands on the iframe. A non-Premium
   account is called out by name in the UI, because it is the likeliest failure
   and the one a user can act on.

The volume level itself persists to `localStorage` (`spotify.volume`) like every
other dashboard preference, and is re-applied whenever a device becomes ready.

## Consequences

**Positive**

- A volume control that actually controls volume, plus real transport (play,
  pause, next, previous) which the embed also could not offer.
- The zero-setup path is untouched. Nothing about the default experience changes.
- No backend, so ADR 0001 still holds.

**Negative**

- **Premium only.** Free accounts get the embed. This is Spotify's restriction,
  not a choice available to us.
- **Setup is more involved than the other integrations.** It needs a registered
  Spotify app *and* an exact-match redirect URI, which differs between
  `localhost:5173` and the GitHub Pages base path — both must be registered.
- **A second playback surface to reason about.** The panel now has two modes,
  and the source tabs mean something slightly different in each: in embed mode a
  tab reloads the iframe, in player mode it issues a Web API play call.
- `sessionStorage` is still XSS-reachable. It is a meaningful improvement over
  `localStorage` for a token, not a guarantee.

## Alternatives considered

- **A slider that adjusts nothing.** Rejected outright — a control that lies is
  worse than an absent one.
- **Spotify Web API `PUT /me/player/volume`.** Also Premium-only, and it targets
  the user's *active Connect device*. The embed is not a Connect device, so this
  would not have controlled the thing on screen.
- **Wait for Spotify to add embed volume.** Open since 2020; not a plan.
