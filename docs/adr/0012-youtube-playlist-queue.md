# ADR 0012: The YouTube panel draws its own playlist queue

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner

## Context

ADR 0007 already parses a `list=` out of a pasted link and hands it to the embed,
so a playlist has always *played* correctly: the panel runs the list end to end
rather than stopping after one video.

What it never did was say so. The embed plays a video, then another video, with
no visible difference from a single-video source — the queue is folded behind a
control in YouTube's chrome that most people never open, and the source tab says
"Playlist", or "Video" when the link happened to name one inside a list. So a
saved playlist looked like a source that mysteriously kept changing what it was
playing, and there was no way to skip to the fourth track without leaving the
dashboard for YouTube.

ADR 0007 §2 declared the panel embed-only, on the grounds that YouTube's player
already draws volume and transport controls and rebuilding them would add a
second playback surface. That reasoning holds for the transport. It does not
reach the queue, because the queue is the one thing the embed does *not* put on
screen.

## Decision

**Read the playlist out of the embed with YouTube's IFrame Player API, and draw
it under the player. Read-only — no playback controls.**

1. **`enablejsapi=1` on playlist embeds only.** A single video has no queue to
   read, so its URL is unchanged and no API script loads for it. The `origin`
   parameter goes on beside it: the player will only answer this page.
2. **The API attaches to the iframe React already rendered** rather than
   creating its own. The embed stays declarative, so it is exactly the same
   player, on the same `youtube-nocookie.com` host, whether or not the API
   arrives.
3. **Strictly read-only over playback.** The hook exposes what is in the list,
   which item is playing, its title, and `playVideoAt`. No volume, no play/pause,
   no next/previous — those are drawn inside the player, and ADR 0007 turned down
   rebuilding them. Clicking a thumbnail is navigation, which the embed offers
   nowhere.
4. **A strip of thumbnails, not a list of titles.** Thumbnails come from
   `i.ytimg.com` with no key and no cookie; per-item *titles* would need one
   oEmbed request per video, or the Data API and a key. One horizontal row costs
   the panel a fixed 54px however long the playlist is.
5. **The tab is named after the playlist**, via a single oEmbed lookup when the
   link is pasted. Keyless, cached in the saved source, and best-effort — an
   unlisted playlist or an offline browser keeps the generic label.
6. **Every part of this degrades to what shipped before.** A blocked script, a
   slow handshake, or a player that never answers leaves the queue unrendered and
   the embed playing.

## Consequences

**Positive**

- A playlist announces itself: a glyph on the tab, its real name, its length, and
  where playback has got to.
- Skipping ahead no longer means opening YouTube.
- The queue moves with playback, so the panel stays honest about what is on
  without polling anything.

**Negative**

- **A third-party script on the page**, from `www.youtube.com`, for playlist
  sources only. The panel already embeds a `youtube-nocookie.com` iframe, so this
  is a new host but not a new relationship.
- **The queue is only as good as the player's answer.** Ads, an unavailable
  video, or a mix that grows as it plays all move under it.
- **Thumbnails without titles.** The strip says which item, not what it is called
  — except for the one playing.
- One more surface tied to an undocumented-in-places API; `getVideoData` in
  particular is widely used but not in YouTube's reference.

## Alternatives considered

- **A badge saying "Playlist" and nothing else.** Rejected: it answers "is this a
  playlist" and none of "which one", "how long", "where am I", "can I skip".
- **Let the IFrame API create the player.** Rejected: it would mean the panel has
  two ways to render an embed, and a source that renders nothing at all if the
  script is blocked.
- **YouTube Data API v3 for playlist items with titles.** Rejected: needs an API
  key in the build and a quota to watch, which is exactly what ADR 0001 rules
  out.
- **One oEmbed request per queue item, for titles.** Rejected: a 200-video
  playlist is 200 requests to render a strip that is mostly off-screen.
- **Rebuild next/previous while we are here.** Rejected, per ADR 0007 §2 — they
  are already in the player, an inch above.
