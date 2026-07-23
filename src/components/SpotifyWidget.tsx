import { useState } from 'react';
import Widget from './Widget';
import { useLocalStorage } from '../hooks/useLocalStorage';

/** A saved Spotify source that can be loaded into the embedded player. */
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

// Multi-item sources get Spotify's tall player with a track list; single items
// (a track or a podcast episode) only need the compact bar.
const frameHeight = (type: SpotifyType): number =>
  type === 'track' || type === 'episode' ? 152 : 352;

/**
 * Embedded Spotify player. Users save one or more Spotify sources — a playlist,
 * album, track, artist, episode, or show — by pasting its share link, then switch
 * between them via tabs. The selected source loads in Spotify's official iframe
 * player. Sources and the current selection persist to localStorage.
 *
 * This uses Spotify's embed rather than the Web Playback SDK, so it needs no
 * account, credentials, or backend (keeping the app client-only). Full-length
 * playback requires being logged into Spotify in this browser; otherwise Spotify
 * serves 30-second previews. Premium would unlock a true in-widget player — a
 * future upgrade.
 */
export default function SpotifyWidget() {
  const [sources, setSources] = useLocalStorage<Source[]>('spotify.sources', DEFAULTS);
  const [currentId, setCurrentId] = useLocalStorage<string>('spotify.current', DEFAULTS[0].id);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');

  const current = sources.find((s) => s.id === currentId) ?? sources[0];

  const add = () => {
    const parsed = parseSource(link);
    if (!parsed) {
      setError('That doesn’t look like a Spotify link. Copy one from Share → Copy link.');
      return;
    }
    const cap = parsed.type.charAt(0).toUpperCase() + parsed.type.slice(1);
    const id = `${Date.now()}`;
    setSources([...sources, { id, label: label.trim() || cap, type: parsed.type, sid: parsed.sid }]);
    setCurrentId(id);
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
      action={
        <button
          className="pill"
          onClick={() => {
            setAdding((a) => !a);
            setError('');
          }}
          title="Add a playlist, album, or track"
        >
          {adding ? '×' : '+'}
        </button>
      }
    >
      {adding && (
        <div className="reminder__form">
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
          <button className="btn" onClick={add}>
            Save
          </button>
        </div>
      )}
      {error && <p className="muted small">{error}</p>}

      {sources.length > 0 && (
        <div className="spotify__tabs">
          {sources.map((s) => (
            <span key={s.id} className="spotify__tab">
              <button
                className={`pill${s.id === current?.id ? ' is-active' : ''}`}
                onClick={() => setCurrentId(s.id)}
                title={`Play ${s.label}`}
              >
                {s.label}
              </button>
              <button
                className="spotify__del"
                onClick={() => remove(s.id)}
                title={`Remove ${s.label}`}
                aria-label={`Remove ${s.label}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {current ? (
        <div className="spotify__frame">
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
      ) : (
        <p className="empty">
          No music yet. Hit <strong>+</strong> and paste a Spotify link (Share → Copy link) for
          a playlist, album, or song.
        </p>
      )}

      <p className="muted small spotify__hint">
        Log in to Spotify in this browser to hear full tracks; otherwise you get 30-second previews.
      </p>
    </Widget>
  );
}
