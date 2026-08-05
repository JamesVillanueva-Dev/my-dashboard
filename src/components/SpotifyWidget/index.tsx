import { useRef, useState } from 'react';
import Widget from '../Widget';
import Icon from '../Icon';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useSpotifyPlayer } from '../../hooks/useSpotifyPlayer';
import styles from './styles.module.css';

/** A saved Spotify source that can be loaded into the player. */
interface Source {
  /** Internal, stable id for React keys and selection. */
  id: string;
  /** Human label shown on the source's tab. */
  label: string;
  /** Spotify entity type, e.g. "playlist" or "track". */
  type: SpotifyType;
  /** Spotify entity id (the base-62 code from the share URL). */
  sid: string;
}

/** The Spotify entities a source can point at — everything its embed supports. */
type SpotifyType = 'track' | 'album' | 'playlist' | 'artist' | 'episode' | 'show';

// "Today's Top Hits" — a public editorial playlist, so the widget plays something
// the moment it's first shown instead of an empty box.
const DEFAULTS: Source[] = [
  { id: '1', label: "Today's Top Hits", type: 'playlist', sid: '37i9dQZF1DXcBWIGoYBM5M' },
];

/**
 * Parses a Spotify share URL or URI into its entity `{ type, sid }`.
 *
 * Accepts the copy-link URL form (`https://open.spotify.com/playlist/ID?si=…`,
 * including the optional `intl-xx/` locale segment) and the app URI form
 * (`spotify:playlist:ID`). Any trailing query string is ignored.
 *
 * @param raw - Pasted Spotify link or URI.
 * @returns The parsed entity, or `null` if it isn't a recognisable Spotify link.
 */
function parseSource(raw: string): { type: SpotifyType; sid: string } | null {
  const s = raw.trim();
  const uri = s.match(/^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]+)/i);
  if (uri) return { type: uri[1].toLowerCase() as SpotifyType, sid: uri[2] };
  const url = s.match(
    /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/i,
  );
  if (url) return { type: url[1].toLowerCase() as SpotifyType, sid: url[2] };
  return null;
}

/** Builds the theme-aware embed URL Spotify serves inside the iframe player. */
function embedUrl(src: Source): string {
  return `https://open.spotify.com/embed/${src.type}/${src.sid}?utm_source=generator&theme=0`;
}

/** The `spotify:type:id` URI the Web API expects when starting playback. */
const sourceUri = (src: Source): string => `spotify:${src.type}:${src.sid}`;

// Multi-item sources get Spotify's tall player with a track list; single items
// (a track or a podcast episode) only need the compact bar.
const frameHeight = (type: SpotifyType): number =>
  type === 'track' || type === 'episode' ? 152 : 352;

/**
 * Music panel. Users save Spotify sources — a playlist, album, track, artist,
 * episode, or show — by pasting a share link, then switch between them via tabs.
 * Sources and the current selection persist to localStorage.
 *
 * The panel has two playback modes:
 *
 * - **Embed (default).** Spotify's official iframe player. Needs no account,
 *   credentials, or backend, so the dashboard stays zero-setup (ADR 0001). The
 *   trade-off is that a cross-origin iframe cannot be controlled from this page:
 *   no volume, no transport. Full-length playback needs a Spotify login in the
 *   browser; otherwise Spotify serves 30-second previews.
 * - **In-page player.** When `VITE_SPOTIFY_CLIENT_ID` is set and the user
 *   connects a Premium account, the widget runs a real Web Playback SDK device
 *   and renders its own transport and **volume** control. See ADR 0006.
 *
 * The player falls back to the embed whenever the SDK is unavailable — not
 * configured, not connected, or not Premium — so the panel always plays music.
 */
export default function SpotifyWidget() {
  const [sources, setSources] = useLocalStorage<Source[]>('spotify.sources', DEFAULTS);
  const [currentId, setCurrentId] = useLocalStorage<string>('spotify.current', DEFAULTS[0].id);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const player = useSpotifyPlayer();
  // Volume to restore when un-muting; the slider itself only ever holds 0–1.
  const beforeMute = useRef(0.5);

  const current = sources.find((s) => s.id === currentId) ?? sources[0];
  const live = player.status === 'ready';
  const muted = player.volume === 0;

  const select = (src: Source) => {
    setCurrentId(src.id);
    if (live) player.play(sourceUri(src), src.type === 'track' || src.type === 'episode');
  };

  const toggleMute = () => {
    if (muted) {
      player.setVolume(beforeMute.current || 0.5);
    } else {
      beforeMute.current = player.volume;
      player.setVolume(0);
    }
  };

  const add = () => {
    const parsed = parseSource(link);
    if (!parsed) {
      setError('That doesn’t look like a Spotify link. Copy one from Share → Copy link.');
      return;
    }
    const cap = parsed.type.charAt(0).toUpperCase() + parsed.type.slice(1);
    const id = `${Date.now()}`;
    const next: Source = { id, label: label.trim() || cap, type: parsed.type, sid: parsed.sid };
    setSources([...sources, next]);
    select(next);
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
      title="Spotify"
      className={styles.container}
      action={
        <button
          className={styles.toggle}
          onClick={() => {
            setAdding((a) => !a);
            setError('');
          }}
          title={adding ? 'Cancel' : 'Add a playlist, album, or track'}
          aria-label={adding ? 'Cancel adding a source' : 'Add a playlist, album, or track'}
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
            placeholder="Paste a Spotify link…"
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
                onClick={() => select(s)}
                title={`Play ${s.label}`}
              >
                {s.label}
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
          No music yet. Hit <strong>+</strong> and paste a Spotify link (Share → Copy link) for a
          playlist, album, or song.
        </p>
      ) : live ? (
        <div className={styles.player}>
          <div className={styles.now}>
            {player.track?.art && <img src={player.track.art} alt="" />}
            <div>
              <strong>{player.track?.name ?? 'Nothing playing'}</strong>
              <span>{player.track?.artist ?? `Pick a source to start ${current.label}`}</span>
            </div>
          </div>

          <div className={styles.transport}>
            <button onClick={player.previous} title="Previous" aria-label="Previous track">
              <Icon name="skipBack" />
            </button>
            <button
              className={styles.playPause}
              onClick={player.togglePlay}
              title={player.paused ? 'Play' : 'Pause'}
              aria-label={player.paused ? 'Play' : 'Pause'}
            >
              <Icon name={player.paused ? 'play' : 'pause'} />
            </button>
            <button onClick={player.next} title="Next" aria-label="Next track">
              <Icon name="skipForward" />
            </button>
          </div>

          <div className={styles.volume}>
            <button
              onClick={toggleMute}
              title={muted ? 'Unmute' : 'Mute'}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              <Icon name={muted ? 'volumeMute' : 'volume'} />
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={player.volume}
              onChange={(e) => player.setVolume(Number(e.target.value))}
              aria-label="Volume"
            />
            <span>{Math.round(player.volume * 100)}%</span>
          </div>
        </div>
      ) : (
        <div className={styles.frame}>
          <iframe
            key={current.id}
            title={`Spotify – ${current.label}`}
            src={embedUrl(current)}
            width="100%"
            height={frameHeight(current.type)}
            loading="lazy"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          />
        </div>
      )}

      {player.status === 'disconnected' && (
        <p className={styles.hint}>
          <button className={styles.connect} onClick={player.connect}>
            Connect Spotify Premium
          </button>{' '}
          for in-page volume and transport controls.
        </p>
      )}
      {player.status === 'error' && (
        <p className={styles.hint}>
          {player.premiumRequired
            ? 'In-page playback needs Spotify Premium — using the embedded player instead.'
            : player.error}
        </p>
      )}
      {live && (
        <p className={styles.hint}>
          Playing in this tab as “Dashboard”.{' '}
          <button className={styles.connect} onClick={player.signOut}>
            Disconnect
          </button>
        </p>
      )}
      {player.status === 'off' && (
        <p className={styles.hint}>
          Log in to Spotify in this browser to hear full tracks; otherwise you get 30-second
          previews.
        </p>
      )}
    </Widget>
  );
}
