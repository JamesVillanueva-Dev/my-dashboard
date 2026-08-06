import { useEffect, useRef, useState } from 'react';
import Widget from '../Widget';
import Icon from '../Icon';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useYouTubePlaylist } from '../../hooks/useYouTubePlaylist';
import { playlistTitle, thumbnailUrl } from '../../lib/youtube';
import styles from './styles.module.css';

/** A saved YouTube source that can be loaded into the player. */
interface Source {
  /** Internal, stable id for React keys and selection. */
  id: string;
  /** Human label shown on the source's tab. */
  label: string;
  /** Video id, or `null` for a playlist opened from its own page. */
  videoId: string | null;
  /** Playlist id, or `null` for a standalone video. */
  listId: string | null;
}

/** What a pasted link resolved to. At least one of the two ids is set. */
type Parsed = Pick<Source, 'videoId' | 'listId'>;

/** Video ids are always exactly 11 URL-safe characters. */
const VIDEO_ID = /^[\w-]{11}$/;
/**
 * Playlist ids vary in length, but always start with one of these prefixes.
 *
 * `WL` (Watch Later) and `LL…` (Liked videos) are deliberately absent: both are
 * private to a single account, and the embedded player renders "This video is
 * unavailable" for them however the URL is built. Dropping them here means a
 * `watch?v=…&list=WL` link still plays its video instead of loading a dead
 * playlist. Auto-generated `RD…` mixes, by contrast, embed and play fine.
 */
const LIST_ID = /^(?:PL|OL|UU|FL|RD)[\w-]*$/;

/** The private playlists above, matched so they can be reported rather than ignored. */
const PRIVATE_LIST = /^(?:WL$|LL)/;

/**
 * `RD…` lists are the mixes YouTube generates around a video rather than
 * playlists somebody made, so they have no name of their own to look up.
 */
const MIX_ID = /^RD/;

/** Hosts whose links this widget knows how to turn into an embed. */
const HOSTS = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)$/i;

/** `/embed/videoseries` is the playlist route, not a video id that happens to be 11 chars. */
const VIDEOSERIES = 'videoseries';

// NoCopyrightSounds' own playlist, so the widget plays something the moment it's
// first shown instead of an empty box.
//
// Deliberately a playlist and deliberately *not* a livestream. A 24/7 radio
// stream looks like the perfect default right up until it goes offline, and then
// every first-run dashboard shows "This live stream recording is not available"
// with no way for the user to know the panel is fine. A playlist of ordinary
// uploads from a channel whose whole model is being embedded royalty-free has
// neither failure mode, and it keeps playing past the first track.
const DEFAULTS: Source[] = [
  {
    id: '1',
    label: 'NoCopyrightSounds',
    videoId: null,
    listId: 'PLRBp0Fe2GpgmsW46rJyudVFlY6IYjFBIK',
  },
];

/**
 * The livestream this widget originally shipped as its default, which has since
 * gone offline — the embed now renders "This live stream recording is not
 * available" instead of a player.
 *
 * Correcting {@link DEFAULTS} does not reach a dashboard that already opened the
 * panel: `useLocalStorage` persists on mount and reads storage back in
 * preference to its fallback forever after, so the dead id would survive every
 * future release. {@link repairSources} retires it on read.
 */
const RETIRED_DEFAULT = 'jfKfPfyJRdk';

/**
 * Replaces the retired default source with the current one, preserving its id so
 * a saved `youtube.current` still selects it.
 *
 * Matches on the shipped entry alone — its id and its video — because sources
 * the user added carry a `Date.now()` id and are never rewritten. Returns the
 * original array when there is nothing to repair, so the caller can persist the
 * result by reference check.
 */
function repairSources(stored: Source[]): Source[] {
  const stale = (s: Source) => s.id === DEFAULTS[0].id && s.videoId === RETIRED_DEFAULT;
  if (!stored.some(stale)) return stored;
  return stored.map((s) => (stale(s) ? { ...DEFAULTS[0], id: s.id } : s));
}

/** Parses `raw` as a URL, tolerating a missing scheme. */
function toUrl(raw: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

/**
 * Parses a YouTube link into the `{ videoId, listId }` an embed needs.
 *
 * Accepts every shape YouTube's own Share button produces — `watch?v=`,
 * `youtu.be/`, `playlist?list=`, `shorts/`, `live/`, `embed/`, and the
 * `music.youtube.com` equivalents — plus a bare video or playlist id. A
 * `watch?v=…&list=…` link keeps both, so the video plays inside its playlist
 * exactly as it would on YouTube.
 *
 * @param raw - Pasted YouTube link, or a bare id.
 * @returns The parsed ids, or `null` if it isn't a recognisable YouTube link.
 */
function parseSource(raw: string): Parsed | null {
  const s = raw.trim();
  if (!s) return null;
  if (VIDEO_ID.test(s)) return { videoId: s, listId: null };
  if (LIST_ID.test(s)) return { videoId: null, listId: s };

  const url = toUrl(s);
  if (!url || !HOSTS.test(url.hostname)) return null;

  const list = url.searchParams.get('list');
  const listId = list && LIST_ID.test(list) ? list : null;

  const v = url.searchParams.get('v');
  // youtu.be puts the id at the root; everywhere else it follows a route segment.
  const inPath = url.hostname.toLowerCase().endsWith('youtu.be')
    ? url.pathname.match(/^\/([\w-]{11})/)
    : url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
  const fromPath = !inPath || inPath[1] === VIDEOSERIES ? null : inPath[1];
  const videoId = v && VIDEO_ID.test(v) ? v : fromPath;

  if (!videoId && !listId) return null;
  return { videoId, listId };
}

/**
 * True when `raw` points at a playlist only its owner can see. Those parse to
 * nothing, and saying so beats the generic "not a YouTube link" — the link is
 * perfectly valid, it just cannot be embedded by anyone.
 */
function namesPrivateList(raw: string): boolean {
  const s = raw.trim();
  if (PRIVATE_LIST.test(s)) return true;
  const url = toUrl(s);
  const list = url && HOSTS.test(url.hostname) ? url.searchParams.get('list') : null;
  return list !== null && PRIVATE_LIST.test(list);
}

/**
 * Builds the embed URL YouTube serves inside the iframe player.
 *
 * `youtube-nocookie.com` is YouTube's own privacy-enhanced host: it holds off on
 * tracking cookies until playback starts, which is the closer match to a
 * dashboard that otherwise keeps everything in this browser (ADR 0001).
 */
function embedUrl(src: Source): string {
  const params = new URLSearchParams({ rel: '0' });
  if (src.listId) {
    params.set('list', src.listId);
    // Opts the embed into the IFrame API, which is the only way the page can ask
    // it what is in the queue (ADR 0012). `origin` is the security half of that
    // handshake: the player will only answer this page. Set for playlists alone,
    // since a single video has no queue to read.
    params.set('enablejsapi', '1');
    params.set('origin', window.location.origin);
  }
  return `https://www.youtube-nocookie.com/embed/${src.videoId ?? VIDEOSERIES}?${params}`;
}

/**
 * Label used when the user doesn't name a source themselves.
 *
 * A playlist is named "Playlist" only until {@link playlistTitle} comes back with
 * what YouTube calls it. Mixes never get that far — they are generated per
 * viewer and have no title to fetch — so they say what they are instead.
 */
const defaultLabel = (parsed: Parsed): string => {
  if (!parsed.listId) return 'Video';
  return MIX_ID.test(parsed.listId) ? 'Mix' : 'Playlist';
};

/**
 * Music panel backed by YouTube. Users save sources — a video, a playlist, a
 * live radio stream, a YouTube Music link — by pasting a share link, then switch
 * between them via tabs. Sources and the current selection persist to
 * localStorage.
 *
 * Playback is YouTube's official iframe embed, which needs no account,
 * credentials, or backend, so the dashboard stays zero-setup (ADR 0001). Unlike
 * the Spotify embed (ADR 0006), YouTube's player chrome carries its own volume
 * and transport controls, so there is nothing here for the panel to rebuild and
 * no second, opt-in playback mode to reason about.
 *
 * A playlist source draws one thing the embed does not: its queue, as a strip of
 * thumbnails under the player marking where in the list playback is, and jumping
 * to any of them on click (ADR 0012).
 */
export default function YouTubeWidget() {
  const [stored, setSources] = useLocalStorage<Source[]>('youtube.sources', DEFAULTS);
  const [currentId, setCurrentId] = useLocalStorage<string>('youtube.current', DEFAULTS[0].id);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  // The live embed element, held in state rather than a ref so that swapping
  // sources re-runs the hook below against the new frame.
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);

  const sources = repairSources(stored);
  const current = sources.find((s) => s.id === currentId) ?? sources[0];

  const queue = useYouTubePlaylist(current?.listId ? frame : null);
  const strip = useRef<HTMLOListElement>(null);

  // Follow playback along the strip, so the thumbnail that is playing is on
  // screen when a track ends and the next one starts.
  //
  // Scrolls the strip itself rather than calling `scrollIntoView` on the
  // thumbnail: that walks every scrollable ancestor, so an unattended playlist
  // would haul the whole dashboard back to this panel each time a track changed.
  useEffect(() => {
    const list = strip.current;
    const active = list?.children[queue.index] as HTMLElement | undefined;
    if (!list || !active) return;
    // Both offsets are measured from the same ancestor — the strip establishes no
    // positioning of its own — so the difference is the item's place within it.
    const left = active.offsetLeft - list.offsetLeft - (list.clientWidth - active.clientWidth) / 2;
    list.scrollTo?.({
      left,
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  }, [queue.index]);

  // Write the repair back, so a dashboard carrying the retired default is healed
  // once rather than re-patched on every load. `repairSources` is identity when
  // there is nothing to fix, so this settles after a single pass.
  useEffect(() => {
    if (sources !== stored) setSources(sources);
  }, [sources, stored, setSources]);

  const add = () => {
    const parsed = parseSource(link);
    if (!parsed) {
      setError(
        namesPrivateList(link)
          ? 'Watch Later and Liked videos are private to your account, so YouTube won’t play them in an embed. Paste a video or a normal playlist instead.'
          : 'That doesn’t look like a YouTube link. Copy one from Share.',
      );
      return;
    }
    const named = label.trim();
    const next: Source = {
      id: `${Date.now()}`,
      label: named || defaultLabel(parsed),
      ...parsed,
    };
    setSources([...sources, next]);
    setCurrentId(next.id);
    // Ask YouTube what the playlist is called, and adopt the answer as the tab's
    // name. Fire-and-forget: the source is already saved and playing under its
    // generic label, and this only ever improves on it.
    if (!named && parsed.listId && !MIX_ID.test(parsed.listId)) {
      playlistTitle(parsed.listId).then((title) => {
        if (title) {
          setSources((prev) => prev.map((s) => (s.id === next.id ? { ...s, label: title } : s)));
        }
      });
    }
    setLabel('');
    setLink('');
    setError('');
    setAdding(false);
  };

  const remove = (id: string) => {
    const next = sources.filter((s) => s.id !== id);
    setSources(next);
    if (id === currentId && next.length) setCurrentId(next[0].id);
  };

  return (
    <Widget
      title="YouTube"
      className={styles.container}
      action={
        <button
          className={styles.toggle}
          onClick={() => {
            setAdding((a) => !a);
            setError('');
          }}
          title={adding ? 'Cancel' : 'Add a video or playlist'}
          aria-label={adding ? 'Cancel adding a source' : 'Add a video or playlist'}
        >
          <Icon name={adding ? 'close' : 'plus'} />
        </button>
      }
    >
      {adding && (
        <div className={styles.form}>
          <input
            type="text"
            placeholder="Name (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <input
            type="text"
            placeholder="Paste a YouTube link…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className={styles.add} onClick={add}>
            Save
          </button>
        </div>
      )}
      {error && <p className={styles.error}>{error}</p>}

      {sources.length > 0 && (
        <div className={styles.tabs}>
          {sources.map((s) => (
            <span key={s.id}>
              <button
                className={`${styles.tab}${s.id === current?.id ? ` ${styles.isActive}` : ''}`}
                onClick={() => setCurrentId(s.id)}
                title={`Play ${s.label}`}
              >
                {s.listId && <Icon name="list" />}
                <span>{s.label}</span>
              </button>
              <button
                className={styles.del}
                onClick={() => remove(s.id)}
                title={`Remove ${s.label}`}
                aria-label={`Remove ${s.label}`}
              >
                <Icon name="close" />
              </button>
            </span>
          ))}
        </div>
      )}

      {!current ? (
        <p className={styles.empty}>
          No music yet. Hit <strong>+</strong> and paste a YouTube link (Share) for a video, a
          playlist, or a live radio stream.
        </p>
      ) : (
        <div className={styles.frame}>
          <iframe
            key={current.id}
            ref={setFrame}
            title={`YouTube – ${current.label}`}
            src={embedUrl(current)}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      )}

      {/* Only once the player has answered with a real queue; a playlist of one,
          or an embed the API never reached, has nothing to show. */}
      {queue.items.length > 1 && (
        <div className={styles.queue}>
          <div>
            <Icon name="list" />
            {queue.title && <strong>{queue.title}</strong>}
            {/* The player reports no position while it is between items or
                playing an ad, which is a moment to drop the "4 /", not the length. */}
            <span>
              {queue.index >= 0 && `${queue.index + 1} / `}
              {queue.items.length}
            </span>
          </div>
          <ol ref={strip} aria-label={`${current?.label} queue`}>
            {queue.items.map((videoId, i) => (
              <li key={`${videoId}-${i}`}>
                <button
                  className={i === queue.index ? styles.isActive : undefined}
                  onClick={() => queue.playAt(i)}
                  title={`Play track ${i + 1}`}
                  aria-label={`Play track ${i + 1}`}
                  aria-current={i === queue.index || undefined}
                >
                  <img src={thumbnailUrl(videoId)} alt="" loading="lazy" width="96" height="54" />
                  <span>{i + 1}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className={styles.hint}>Volume and playback controls live inside the player.</p>
    </Widget>
  );
}
