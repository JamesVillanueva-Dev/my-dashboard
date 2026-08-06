import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * YouTube's IFrame Player API, loaded on demand by {@link loadApi}.
 *
 * The script is the documented way to talk to an embed that carries
 * `enablejsapi=1`; it wraps the existing `<iframe>` rather than replacing it, so
 * the player on screen is the same one React rendered.
 */
const API_SRC = 'https://www.youtube.com/iframe_api';

/* ---------- Minimal typings for the IFrame API global ---------- */

/** What the player reports about the item playing right now. */
interface VideoData {
  /** Id of the current video. */
  video_id: string;
  /** Its title, as YouTube has it. */
  title: string;
}

/** The methods this hook calls on a player instance. */
interface Player {
  /** Video ids of the loaded playlist, in order; `null` for a single video. */
  getPlaylist(): string[] | null;
  /** Zero-based position of the current item, or `-1` before one is known. */
  getPlaylistIndex(): number;
  /** The current item; undefined until the player has loaded something. */
  getVideoData(): VideoData | undefined;
  /** Jumps to a position in the playlist and plays it. */
  playVideoAt(index: number): void;
}

/** Every player event this hook listens for carries the player that raised it. */
interface PlayerEvent {
  target: Player;
}

/** The `window.YT` global the API script installs. */
interface YouTubeGlobal {
  /** Attaches a player to an existing `enablejsapi=1` iframe. */
  Player: new (
    frame: HTMLIFrameElement,
    options: { events: Record<string, (event: PlayerEvent) => void> },
  ) => Player;
}
declare global {
  interface Window {
    YT?: YouTubeGlobal;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** In-flight (or settled) script load, so remounts do not add a second `<script>`. */
let apiPromise: Promise<YouTubeGlobal> | null = null;

/** Loads the IFrame Player API once per page, resolving its global. */
function loadApi(): Promise<YouTubeGlobal> {
  // `window.YT` appears as soon as the script starts, but `YT.Player` only once
  // it has finished initialising — which is what the ready callback announces.
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YouTubeGlobal>((resolve, reject) => {
    window.onYouTubeIframeAPIReady = () => {
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('The YouTube player API loaded but its global is unavailable'));
    };
    const script = document.createElement('script');
    script.src = API_SRC;
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load the YouTube player API'));
    document.head.appendChild(script);
  });
  return apiPromise;
}

/** The playlist loaded in an embed, as far as the player will say. */
export interface Playlist {
  /** Video ids in playing order. Empty until the player reports a playlist. */
  items: string[];
  /** Zero-based position of the item playing now, or `-1` if not known yet. */
  index: number;
  /** Title of the item playing now, or `null` before one has loaded. */
  title: string | null;
  /** Jumps the player to a position. No-op until the player is attached. */
  playAt: (index: number) => void;
}

/** The reported half of {@link Playlist}: everything the player answers with. */
type Queue = Pick<Playlist, 'items' | 'index' | 'title'>;

/** What the hook reports before — or without — a player to read. */
const EMPTY: Queue = { items: [], index: -1, title: null };

/**
 * Reads the playlist out of a YouTube embed and lets the page jump around it.
 *
 * The embed plays a playlist perfectly well on its own; what it does not do is
 * *say* that it is one. Its chrome shows a video, then another video, with the
 * queue folded away behind a control most people never open. This hook is how the
 * panel draws that queue itself: which videos are in the list, which one is
 * playing, and a way to pick another.
 *
 * Deliberately read-only over playback — no volume, no play/pause, no skip. Those
 * are already drawn inside the player, and ADR 0007 turned down rebuilding them;
 * the queue is the part that has nowhere else to appear (ADR 0012).
 *
 * Entirely best-effort. If the API script is blocked or slow, every field stays
 * empty and the caller simply renders no queue — the embed underneath is
 * untouched and still plays.
 *
 * @param frame - The embed to read, or `null` to attach to nothing. Must have
 *   been rendered with `enablejsapi=1`, or the player will never answer.
 * @returns The playlist state; see {@link Playlist}.
 */
export function useYouTubePlaylist(frame: HTMLIFrameElement | null): Playlist {
  // The queue is stored with the embed it came out of, so a switch of source can
  // be spotted here rather than left to an effect — otherwise one playlist's
  // items would render against another's for a frame.
  const [state, setState] = useState<Queue & { frame: HTMLIFrameElement | null }>({
    ...EMPTY,
    frame,
  });
  const playerRef = useRef<Player | null>(null);

  if (state.frame !== frame) setState({ ...EMPTY, frame });

  useEffect(() => {
    playerRef.current = null;
    if (!frame) return;

    let attached = true;
    const read = ({ target }: PlayerEvent) => {
      if (!attached) return;
      setState({
        frame,
        items: target.getPlaylist() ?? [],
        index: target.getPlaylistIndex(),
        title: target.getVideoData()?.title ?? null,
      });
    };

    loadApi()
      .then((YT) => {
        if (!attached) return;
        // The player answers once for the initial load, then on every transition
        // — which is what moves the highlight as one video ends and the next
        // starts, without this hook polling for it.
        playerRef.current = new YT.Player(frame, {
          events: { onReady: read, onStateChange: read },
        });
      })
      // No API, no queue. The embed itself is unaffected, so there is nothing
      // here worth telling the user about.
      .catch(() => {});

    return () => {
      attached = false;
      playerRef.current = null;
      // Deliberately no `player.destroy()`: it removes the iframe from the DOM,
      // and that element belongs to React. Dropping the reference is enough —
      // the player has no timers of its own, and it goes quiet the moment React
      // unmounts the frame it was listening to.
    };
  }, [frame]);

  const playAt = useCallback((index: number) => playerRef.current?.playVideoAt(index), []);

  const { items, index, title } = state;
  return { items, index, title, playAt };
}
