import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalStorage } from './useLocalStorage';
import {
  completeAuthFromRedirect,
  disconnect as dropSession,
  getAccessToken,
  hasSpotifyClientId,
  isConnected,
} from '../lib/spotifyAuth';

/** The Web Playback SDK, loaded on demand by {@link loadSdk}. */
const SDK_SRC = 'https://sdk.scdn.co/spotify-player.js';
/** Spotify Web API root, used for the transport calls the SDK does not cover. */
const API = 'https://api.spotify.com/v1';

/* ---------- Minimal typings for the Web Playback SDK global ---------- */

/** A track as the SDK reports it, before {@link NowPlaying} flattens it. */
interface SdkTrack {
  /** Track title. */
  name: string;
  /** Every credited artist; the widget joins them into one line. */
  artists: { name: string }[];
  /** Cover art in several sizes; the first entry is the one displayed. */
  album: { images: { url: string }[] };
}
/** A playback state change, pushed by the SDK whenever anything moves. */
interface SdkState {
  /** Whether playback is currently paused. */
  paused: boolean;
  /** Position within the track, ms. */
  position: number;
  /** Track length, ms. */
  duration: number;
  /** Where the current track lives; `null` before anything has played. */
  track_window: { current_track: SdkTrack | null };
}
/** The methods this hook calls on an SDK player instance. */
interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (payload: never) => void): boolean;
  removeListener(event: string): boolean;
  setVolume(value: number): Promise<void>;
  togglePlay(): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
}
/** The `window.Spotify` global the SDK script installs. */
interface SpotifyGlobal {
  /**
   * Constructs a playback device. `name` is what the user sees in Spotify
   * Connect, and `getOAuthToken` is called back whenever the SDK needs a fresh
   * token — which is why token renewal is not this hook's problem.
   */
  Player: new (options: {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }) => SdkPlayer;
}
declare global {
  interface Window {
    Spotify?: SpotifyGlobal;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

/** In-flight (or settled) script load, so remounts do not add a second `<script>`. */
let sdkPromise: Promise<SpotifyGlobal> | null = null;

/** Loads the Web Playback SDK once per page, resolving its global. */
function loadSdk(): Promise<SpotifyGlobal> {
  if (window.Spotify) return Promise.resolve(window.Spotify);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<SpotifyGlobal>((resolve, reject) => {
    // The SDK calls this global the moment it finishes initialising; it must be
    // defined before the script runs.
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (window.Spotify) resolve(window.Spotify);
      else reject(new Error('Spotify SDK loaded but the global is unavailable'));
    };
    const script = document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load the Spotify player'));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/** The now-playing track, flattened for display. */
export interface NowPlaying {
  /** Track title. */
  name: string;
  /** Every credited artist, comma-joined. */
  artist: string;
  /** Cover art URL, or `null` when the track has no artwork. */
  art: string | null;
}

/**
 * Lifecycle of the in-widget player.
 *
 * `off` — no client id configured, the integration is switched off entirely.
 * `disconnected` — configured, but this tab holds no Spotify session.
 * `connecting` — session held; SDK loading or the device is not ready yet.
 * `ready` — a playback device is live and controllable.
 * `error` — something failed; see `error`, and `premiumRequired` for the common case.
 */
export type PlayerStatus = 'off' | 'disconnected' | 'connecting' | 'ready' | 'error';

/** What {@link useSpotifyPlayer} returns. */
export interface SpotifyPlayer {
  /** Where the player is in its lifecycle; see {@link PlayerStatus}. */
  status: PlayerStatus;
  /** Human-readable failure, when `status` is `error`. */
  error: string | null;
  /** True when the failure was specifically "this account is not Premium". */
  premiumRequired: boolean;
  /** This browser's device id, once registered with Spotify Connect. */
  deviceId: string | null;
  /** The current track, or null when nothing has played yet. */
  track: NowPlaying | null;
  /** Whether playback is paused. `true` before anything has played. */
  paused: boolean;
  /** Volume in 0–1. Persisted, and applied whenever a device becomes ready. */
  volume: number;
  /** Sets the volume on the device and persists it for next time. */
  setVolume: (value: number) => void;
  /** Play/pause. No-op unless a device is ready. */
  togglePlay: () => void;
  /** Skips to the next track in Spotify's queue. */
  next: () => void;
  /** Skips back, however Spotify's SDK chooses to interpret that. */
  previous: () => void;
  /** Sends the user to Spotify's consent screen. Must be a user gesture. */
  connect: () => void;
  /** Drops the session and tears the device down. */
  signOut: () => void;
  /** Starts playback of a Spotify URI on this device. */
  play: (uri: string, isSingleTrack: boolean) => void;
}

/**
 * Runs a Spotify Web Playback SDK device in the page and exposes transport and
 * **volume** control over it.
 *
 * Volume is the reason this exists at all: Spotify's iframe embed cannot be
 * volume-controlled from the host page — the frame is cross-origin and the iFrame
 * API exposes no volume method — so a real player is the only way to offer a
 * slider that does anything. See ADR 0006.
 *
 * Everything is inert unless `VITE_SPOTIFY_CLIENT_ID` is set, so the default
 * zero-setup dashboard is untouched.
 */
export function useSpotifyPlayer(): SpotifyPlayer {
  const configured = hasSpotifyClientId();
  const [status, setStatus] = useState<PlayerStatus>(configured ? 'connecting' : 'off');
  const [error, setError] = useState<string | null>(null);
  const [premiumRequired, setPremiumRequired] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [track, setTrack] = useState<NowPlaying | null>(null);
  const [paused, setPaused] = useState(true);
  const [volume, setStoredVolume] = useLocalStorage<number>('spotify.volume', 0.5);

  const playerRef = useRef<SdkPlayer | null>(null);
  // Read inside callbacks that must not re-run when the volume changes.
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  const fail = useCallback((message: string, premium = false) => {
    setStatus('error');
    setError(message);
    setPremiumRequired(premium);
  }, []);

  // Consume an OAuth redirect, then bring up a device if a session is held.
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;

    (async () => {
      try {
        await completeAuthFromRedirect();
      } catch (e) {
        if (!cancelled) fail(e instanceof Error ? e.message : 'Spotify sign-in failed');
        return;
      }
      if (cancelled) return;
      if (!isConnected()) {
        setStatus('disconnected');
        return;
      }

      try {
        const sdk = await loadSdk();
        if (cancelled) return;

        const player = new sdk.Player({
          name: 'Dashboard',
          getOAuthToken: (cb) => {
            getAccessToken().then(cb, (e: Error) => fail(e.message));
          },
          volume: volumeRef.current,
        });
        playerRef.current = player;

        player.addListener('ready', ({ device_id }: { device_id: string }) => {
          setDeviceId(device_id);
          setStatus('ready');
          setError(null);
          player.setVolume(volumeRef.current).catch(() => {});
        });
        player.addListener('not_ready', () => {
          setDeviceId(null);
          setStatus('connecting');
        });
        player.addListener('player_state_changed', (state: SdkState | null) => {
          if (!state) return;
          setPaused(state.paused);
          const t = state.track_window.current_track;
          setTrack(
            t
              ? {
                  name: t.name,
                  artist: t.artists.map((a) => a.name).join(', '),
                  art: t.album.images[0]?.url ?? null,
                }
              : null,
          );
        });
        // A non-Premium account is the single most likely failure, and the one
        // the UI can explain rather than just reporting as broken.
        player.addListener('account_error', ({ message }: { message: string }) =>
          fail(message || 'Spotify Premium is required for in-page playback', true),
        );
        player.addListener('authentication_error', ({ message }: { message: string }) => {
          dropSession();
          fail(message || 'Spotify rejected the session');
        });
        player.addListener('initialization_error', ({ message }: { message: string }) =>
          fail(message || 'The Spotify player could not start'),
        );

        await player.connect();
      } catch (e) {
        if (!cancelled) fail(e instanceof Error ? e.message : 'The Spotify player could not start');
      }
    })();

    return () => {
      cancelled = true;
      playerRef.current?.disconnect();
      playerRef.current = null;
    };
  }, [configured, fail]);

  const setVolume = useCallback(
    (value: number) => {
      const clamped = Math.min(1, Math.max(0, value));
      setStoredVolume(clamped);
      playerRef.current?.setVolume(clamped).catch(() => {});
    },
    [setStoredVolume],
  );

  const play = useCallback(
    (uri: string, isSingleTrack: boolean) => {
      if (!deviceId) return;
      getAccessToken()
        .then((token) =>
          fetch(`${API}/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            // Tracks and episodes are played as a one-item queue; everything else
            // (playlist, album, artist, show) is a browsable context.
            body: JSON.stringify(isSingleTrack ? { uris: [uri] } : { context_uri: uri }),
          }),
        )
        .catch(() => fail('Could not start playback on this device'));
    },
    [deviceId, fail],
  );

  const signOut = useCallback(() => {
    playerRef.current?.disconnect();
    playerRef.current = null;
    dropSession();
    setDeviceId(null);
    setTrack(null);
    setStatus('disconnected');
    setError(null);
    setPremiumRequired(false);
  }, []);

  const connect = useCallback(() => {
    // Imported lazily so the redirect helper is only pulled in on a real click.
    import('../lib/spotifyAuth').then((m) => m.beginAuth().catch((e: Error) => fail(e.message)));
  }, [fail]);

  return {
    status,
    error,
    premiumRequired,
    deviceId,
    track,
    paused,
    volume,
    setVolume,
    togglePlay: () => void playerRef.current?.togglePlay().catch(() => {}),
    next: () => void playerRef.current?.nextTrack().catch(() => {}),
    previous: () => void playerRef.current?.previousTrack().catch(() => {}),
    connect,
    signOut,
    play,
  };
}
