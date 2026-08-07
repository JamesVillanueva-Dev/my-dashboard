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
  /** Seconds elapsed in the current item. */
  getCurrentTime(): number;
  /** {@link PLAYING} while playing; other codes are paused, buffering, ended. */
  getPlayerState(): number;
  /** Jumps within the current item. */
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  /** Starts, or resumes, playback. */
  playVideo(): void;
}

/** `YT.PlayerState.PLAYING`. The only state this hook needs to tell apart. */
const PLAYING = 1;

/**
 * How often the player's position is read, in ms.
 *
 * This is the resolution a resumed track lands at, and it costs almost nothing:
 * `getCurrentTime` answers from a value the player already pushes to this window
 * as it plays, so a sample is a property read rather than a round trip.
 */
const SAMPLE_MS = 500;

/** Where playback had got to, carried across a reload of the embed. */
interface Resume {
  /** The item that was playing — what identifies it in the reloaded playlist. */
  videoId: string;
  /** Its position in the playlist, or `-1` for a standalone video. */
  index: number;
  /** Seconds elapsed in it. */
  seconds: number;
  /** Whether it was playing, as opposed to paused, when the embed went away. */
  playing: boolean;
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
 * Reads the playlist out of a YouTube embed and lets the page jump around it,
 * and puts playback back where it was when the embed is rebuilt.
 *
 * The embed plays a playlist perfectly well on its own; what it does not do is
 * *say* that it is one. Its chrome shows a video, then another video, with the
 * queue folded away behind a control most people never open. This hook is how the
 * panel draws that queue itself: which videos are in the list, which one is
 * playing, and a way to pick another.
 *
 * The second job comes from the panel's full-screen view. Moving an `<iframe>`
 * to another parent destroys its browsing context — that is the HTML spec, not
 * something React can route around — so opening or closing that view hands the
 * widget a *new* embed, back at the first track from zero. This hook samples the
 * position while a player is attached and, because it outlives any one embed,
 * restores it on the next: same track, same offset, still playing. What the user
 * sees is a video that jumps size, not one that starts over.
 *
 * Deliberately read-only over playback otherwise — no volume, no play/pause, no
 * skip. Those are already drawn inside the player, and ADR 0007 turned down
 * rebuilding them; the queue is the part that has nowhere else to appear
 * (ADR 0012), and a resume is the panel repairing its own damage rather than a
 * transport control.
 *
 * Entirely best-effort. If the API script is blocked or slow, every field stays
 * empty, nothing is restored, and the caller simply renders no queue — the embed
 * underneath is untouched and still plays.
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
  // Outlives every embed this hook is pointed at, which is the whole point: the
  // player that recorded the position is gone by the time one restores it.
  const resumeRef = useRef<Resume | null>(null);

  if (state.frame !== frame) setState({ ...EMPTY, frame });

  useEffect(() => {
    playerRef.current = null;
    if (!frame) return;

    let attached = true;
    /** Set when a resume is waiting on the player to reach the saved track. */
    let seekTo: Resume | null = null;

    const read = ({ target }: PlayerEvent) => {
      if (!attached) return;
      const videoId = target.getVideoData()?.video_id;
      // `playVideoAt` below only gets playback to the right track; the offset
      // has to wait until that track is the one loaded, or the seek would land
      // in whichever video the player was still showing.
      if (seekTo && videoId === seekTo.videoId) {
        target.seekTo(seekTo.seconds, true);
        if (seekTo.playing) target.playVideo();
        seekTo = null;
      }
      setState({
        frame,
        items: target.getPlaylist() ?? [],
        index: target.getPlaylistIndex(),
        title: target.getVideoData()?.title ?? null,
      });
    };

    /** Records where playback is, for whichever embed comes next. */
    const sample = () => {
      const player = playerRef.current;
      const videoId = player?.getVideoData()?.video_id;
      if (!player || !videoId) return;
      resumeRef.current = {
        videoId,
        index: player.getPlaylistIndex(),
        seconds: player.getCurrentTime(),
        playing: player.getPlayerState() === PLAYING,
      };
    };

    /**
     * Puts a freshly loaded embed back where the last one left off.
     *
     * A resume is spent whether or not it is used: it describes one particular
     * embed going away, and the next one either inherits it or has no business
     * with it at all. Switching source is that second case — the saved track is
     * not in the playlist that just loaded, so nothing is restored.
     */
    const restore = ({ target }: PlayerEvent) => {
      const saved = resumeRef.current;
      resumeRef.current = null;
      if (!saved) return;
      const here = target.getVideoData()?.video_id;
      if (saved.videoId !== here && !(target.getPlaylist() ?? []).includes(saved.videoId)) return;
      if (saved.videoId === here) {
        target.seekTo(saved.seconds, true);
        if (saved.playing) target.playVideo();
      } else {
        target.playVideoAt(saved.index);
        seekTo = saved;
      }
    };

    let timer: ReturnType<typeof setInterval> | undefined;

    loadApi()
      .then((YT) => {
        if (!attached) return;
        // The player answers once for the initial load, then on every transition
        // — which is what moves the highlight as one video ends and the next
        // starts, without this hook polling for it.
        playerRef.current = new YT.Player(frame, {
          events: {
            onReady: (event) => {
              restore(event);
              read(event);
              // Only once there is a player to ask, and only after the restore
              // above has had the saved position — a sample from a player still
              // sitting at zero would overwrite the very thing being restored.
              timer = setInterval(sample, SAMPLE_MS);
            },
            onStateChange: read,
          },
        });
      })
      // No API, no queue. The embed itself is unaffected, so there is nothing
      // here worth telling the user about.
      .catch(() => {});

    return () => {
      attached = false;
      playerRef.current = null;
      clearInterval(timer);
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
