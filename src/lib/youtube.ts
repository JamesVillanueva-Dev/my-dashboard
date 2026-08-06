/**
 * YouTube metadata lookups for the music panel.
 *
 * Everything here goes through **oEmbed**, YouTube's public embed-description
 * endpoint. It needs no API key, no account, and no backend, which is the only
 * kind of network call the dashboard is allowed to make on its own (ADR 0001) —
 * the Data API alternative would need a key in the build and a quota to watch.
 */

/** YouTube's oEmbed endpoint. Public, keyless, and CORS-enabled. */
const OEMBED = 'https://www.youtube.com/oembed';

/**
 * Looks up the name a playlist has on YouTube.
 *
 * Used to label a pasted playlist with what it actually is — "Lofi Girl radio"
 * rather than "Playlist" — so a row of source tabs says something. Best-effort by
 * design: unlisted playlists, auto-generated mixes, an offline browser, and a
 * blocked request all resolve to `null`, and the caller keeps its own label.
 *
 * @param listId - A YouTube playlist id.
 * @returns The playlist's title, or `null` if YouTube won't say.
 */
export async function playlistTitle(listId: string): Promise<string | null> {
  const target = `https://www.youtube.com/playlist?list=${listId}`;
  try {
    const res = await fetch(`${OEMBED}?format=json&url=${encodeURIComponent(target)}`);
    if (!res.ok) return null;
    const { title } = (await res.json()) as { title?: unknown };
    return typeof title === 'string' && title.trim() ? title.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Thumbnail for a video, straight from YouTube's image host.
 *
 * `i.ytimg.com` serves these to anyone, with no key and no cookie — the same
 * reason the player is embedded from `youtube-nocookie.com`. `mqdefault` is the
 * 320×180 size, which is the smallest one that still looks sharp on a retina
 * screen at the size the queue draws it.
 *
 * @param videoId - The video's id.
 */
export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}
