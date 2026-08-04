# ADR 0007: YouTube is the default music panel; Spotify becomes opt-in

- **Status:** Accepted
- **Date:** 2026-08-04
- **Deciders:** Project owner

## Context

ADR 0006 got the Spotify panel a real volume control, but only along a path most
people will not take: it needs a registered Spotify app, an exact-match redirect
URI, and a **Premium** account. Everyone else lands on the permanent fallback —
Spotify's iframe embed — and that fallback has a sharper edge than the ADR gave
it credit for.

An embed served to a browser with no Spotify session plays **30-second
previews**. So the default experience of the default music panel, on a dashboard
whose whole premise is that it works with zero setup (ADR 0001), is a third of a
song. The panel is also the only one that cannot be made to work by trying
harder: the shortfall is an account tier, not a missing key.

YouTube's embed has none of those constraints. It plays full tracks to a signed-
out browser, it carries its own volume and transport controls inside the player
chrome, and it covers the material a Spotify playlist cannot — live radio
streams, sets, anything uploaded rather than licensed.

## Decision

**Ship a YouTube panel, enabled by default, and move Spotify to opt-in.**

1. **A new `defaultOff` flag on `WidgetDef`.** `DEFAULT_LAYOUT` is now every
   widget without it, rather than every widget. This is a property of the
   catalogue, not a new kind of setting: `WIDGETS` is unchanged as the list the
   widget menu renders, so Spotify is still one checkbox away and everything
   about it — sources, tabs, the Web Playback SDK, ADR 0006 in full — still
   works when it is switched on.
2. **The YouTube panel is embed-only.** Deliberately not the mirror of ADR 0006.
   YouTube's IFrame API could drive volume from the host page, but the embedded
   player already draws a volume slider and a transport of its own, so rebuilding
   them would add a second playback surface to buy a control that is already on
   screen.
3. **`youtube-nocookie.com`, not `youtube.com`.** YouTube's own privacy-enhanced
   host, which holds off on tracking cookies until playback starts. A dashboard
   that keeps everything else in this browser should not embed the cookie-writing
   variant when the other one renders the same player.
4. **Links parse to `{ videoId, listId }`.** A `watch?v=…&list=…` link keeps
   both, so a video plays inside its playlist exactly as it does on YouTube,
   rather than being flattened to one or the other.

Existing dashboards are untouched: a saved `layout` already naming `spotify`
keeps it, and `DEFAULT_LAYOUT` only decides what a dashboard that has never been
arranged starts with. Those users pick YouTube up from the widget menu, the same
way every other added widget arrives.

## Consequences

**Positive**

- The music panel a new dashboard shows plays whole songs, with working volume,
  with no account and no configuration.
- Spotify's setup cost is now paid only by people who asked for Spotify.
- One more thing the panel can be: a live lo-fi stream is a plausible default in
  a way that a 30-second preview of a top-40 playlist never was.

**Negative**

- **Two music widgets in the catalogue**, which is one more than the menu needs
  and invites "which one do I want?". Mitigated by only one of them being on by
  default.
- **No cross-panel transport.** Enabling both means two independent players that
  can play over each other. Neither knows about the other.
- **YouTube serves ads** to signed-out viewers, which the Spotify embed does not
  do mid-preview. That is the trade for full-length playback.
- Users on an existing dashboard have to add the YouTube panel themselves; a
  default-layout change cannot reach a layout that has already been saved.

## Alternatives considered

- **Remove the Spotify panel.** Rejected: ADR 0006's in-page player is genuinely
  better than an embed for the people who can run it, and deleting it would
  strand their saved sources.
- **One "Music" panel with a source picker.** Rejected for now — it would merge
  two persisted shapes, two link parsers, and two playback models behind one
  widget id, and the migration is more code than the second checkbox costs.
- **Rebuild volume and transport on YouTube's IFrame API.** Rejected: the embed
  already has both. ADR 0006 existed because Spotify's embed does not.
