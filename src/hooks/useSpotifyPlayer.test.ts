import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSpotifyPlayer } from './useSpotifyPlayer';
import {
  beginAuth,
  completeAuthFromRedirect,
  disconnect,
  getAccessToken,
  hasSpotifyClientId,
  isConnected,
} from '../lib/spotifyAuth';

// The whole OAuth layer is covered by its own suite, and the real thing navigates
// the page to Spotify's consent screen. Mocking it lets each test put the hook in
// one situation — unconfigured, signed out, session held — without any redirects.
vi.mock('../lib/spotifyAuth', () => ({
  hasSpotifyClientId: vi.fn(() => true),
  isConnected: vi.fn(() => true),
  completeAuthFromRedirect: vi.fn(() => Promise.resolve(false)),
  getAccessToken: vi.fn(() => Promise.resolve('token-1')),
  disconnect: vi.fn(),
  beginAuth: vi.fn(() => Promise.resolve()),
}));

/** What `play`'s second argument means: one track, or a browsable context. */
const AS_TRACK = true;
const AS_CONTEXT = false;

const SDK_SCRIPT_SELECTOR = 'script[src*="spotify-player"]';

/** The `window.Spotify` global the real SDK script installs. */
type SpotifyGlobal = NonNullable<Window['Spotify']>;
/** What the hook passes to the `Player` constructor. */
type PlayerOptions = ConstructorParameters<SpotifyGlobal['Player']>[0];

/** A stand-in for one Web Playback SDK device, with its listeners exposed. */
function fakeDevice() {
  return {
    listeners: new Map<string, (payload: unknown) => void>(),
    connect: vi.fn(() => Promise.resolve(true)),
    disconnect: vi.fn(),
    addListener: vi.fn(function (this: FakeDevice, event: string, listener: (p: unknown) => void) {
      this.listeners.set(event, listener);
      return true;
    }),
    removeListener: vi.fn(() => true),
    setVolume: vi.fn(() => Promise.resolve()),
    togglePlay: vi.fn(() => Promise.resolve()),
    nextTrack: vi.fn(() => Promise.resolve()),
    previousTrack: vi.fn(() => Promise.resolve()),
  };
}
type FakeDevice = ReturnType<typeof fakeDevice>;

let device: FakeDevice;
/** The mocked `Spotify.Player` constructor. */
let constructPlayer: ReturnType<typeof vi.fn>;
/** Options the hook constructed the device with. */
let playerOptions: PlayerOptions;

/** Installs a fake SDK global, so `loadSdk` resolves without touching the network. */
function installSdk() {
  device = fakeDevice();
  constructPlayer = vi.fn(function (options: PlayerOptions) {
    playerOptions = options;
    return device;
  });
  window.Spotify = { Player: constructPlayer } as unknown as SpotifyGlobal;
}

/** Mounts the hook and waits for it to bring a device up. */
async function renderPlayer() {
  const view = renderHook(() => useSpotifyPlayer());
  await waitFor(() => expect(device.listeners.has('ready')).toBe(true));
  return view;
}

/** Fires an SDK event at the hook's listener for it. */
function emit(event: string, payload: unknown = undefined) {
  act(() => {
    device.listeners.get(event)!(payload);
  });
}

/** Mounts the hook and reports a live device, the ordinary connected state. */
async function renderReadyPlayer() {
  const view = await renderPlayer();
  emit('ready', { device_id: 'device-1' });
  return view;
}

/** A `player_state_changed` payload. */
function playerState(overrides: { paused?: boolean; track?: unknown } = {}) {
  return {
    paused: overrides.paused ?? false,
    position: 0,
    duration: 200_000,
    track_window: {
      current_track:
        'track' in overrides
          ? overrides.track
          : {
              name: 'Song Title',
              artists: [{ name: 'Artist One' }, { name: 'Artist Two' }],
              album: { images: [{ url: 'https://i.scdn.co/image/abc' }] },
            },
    },
  };
}

beforeEach(() => {
  vi.mocked(hasSpotifyClientId).mockReturnValue(true);
  vi.mocked(isConnected).mockReturnValue(true);
  vi.mocked(completeAuthFromRedirect).mockResolvedValue(false);
  vi.mocked(getAccessToken).mockResolvedValue('token-1');
  vi.mocked(beginAuth).mockResolvedValue(undefined);
  installSdk();
});

afterEach(() => {
  delete window.Spotify;
});

describe('useSpotifyPlayer when no client id is configured', () => {
  beforeEach(() => vi.mocked(hasSpotifyClientId).mockReturnValue(false));

  it('stays switched off, so the zero-setup dashboard is untouched', () => {
    const { result } = renderHook(() => useSpotifyPlayer());

    expect(result.current.status).toBe('off');
    expect(result.current.error).toBeNull();
  });

  it('never brings a device up or consumes a redirect', () => {
    renderHook(() => useSpotifyPlayer());

    expect(constructPlayer).not.toHaveBeenCalled();
    expect(completeAuthFromRedirect).not.toHaveBeenCalled();
  });
});

describe('useSpotifyPlayer bringing a device up', () => {
  it('starts out connecting when a client id is configured', () => {
    const { result } = renderHook(() => useSpotifyPlayer());

    expect(result.current.status).toBe('connecting');
  });

  it('reports disconnected when this tab holds no session', async () => {
    vi.mocked(isConnected).mockReturnValue(false);

    const { result } = renderHook(() => useSpotifyPlayer());

    await waitFor(() => expect(result.current.status).toBe('disconnected'));
    expect(constructPlayer).not.toHaveBeenCalled();
  });

  it('names the device so it is identifiable in Spotify Connect', async () => {
    await renderPlayer();

    expect(playerOptions.name).toBe('Dashboard');
  });

  it('starts the device at the persisted volume', async () => {
    localStorage.setItem('spotify.volume', JSON.stringify(0.2));

    await renderPlayer();

    expect(playerOptions.volume).toBe(0.2);
  });

  it('connects the device', async () => {
    await renderPlayer();

    await waitFor(() => expect(device.connect).toHaveBeenCalledTimes(1));
  });

  it('goes ready once Spotify registers the device, exposing its id', async () => {
    const { result } = await renderReadyPlayer();

    expect(result.current.status).toBe('ready');
    expect(result.current.deviceId).toBe('device-1');
    expect(result.current.error).toBeNull();
  });

  it('re-applies the stored volume whenever a device becomes ready', async () => {
    localStorage.setItem('spotify.volume', JSON.stringify(0.3));

    await renderReadyPlayer();

    expect(device.setVolume).toHaveBeenCalledWith(0.3);
  });

  it('falls back to connecting when the device drops out', async () => {
    const { result } = await renderReadyPlayer();

    emit('not_ready', { device_id: 'device-1' });

    expect(result.current.status).toBe('connecting');
    expect(result.current.deviceId).toBeNull();
  });

  it('surfaces a failed sign-in rather than hanging on "connecting"', async () => {
    vi.mocked(completeAuthFromRedirect).mockRejectedValue(new Error('State mismatch'));

    const { result } = renderHook(() => useSpotifyPlayer());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('State mismatch');
    expect(constructPlayer).not.toHaveBeenCalled();
  });

  it('reports a device that refuses to start', async () => {
    constructPlayer.mockImplementation(() => {
      throw new Error('Player unavailable');
    });

    const { result } = renderHook(() => useSpotifyPlayer());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Player unavailable');
  });

  it('tears the device down on unmount', async () => {
    const { unmount } = await renderReadyPlayer();

    unmount();

    expect(device.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('useSpotifyPlayer renewing the token', () => {
  it('hands the SDK a fresh token whenever it asks', async () => {
    await renderPlayer();
    const onToken = vi.fn();

    playerOptions.getOAuthToken(onToken);

    await waitFor(() => expect(onToken).toHaveBeenCalledWith('token-1'));
  });

  it('reports a renewal it cannot complete', async () => {
    const { result } = await renderPlayer();
    vi.mocked(getAccessToken).mockRejectedValue(new Error('Spotify session expired'));

    playerOptions.getOAuthToken(vi.fn());

    await waitFor(() => expect(result.current.error).toBe('Spotify session expired'));
    expect(result.current.status).toBe('error');
  });
});

describe('useSpotifyPlayer now playing', () => {
  it('flattens the SDK track into something renderable', async () => {
    const { result } = await renderReadyPlayer();

    emit('player_state_changed', playerState());

    expect(result.current.track).toEqual({
      name: 'Song Title',
      artist: 'Artist One, Artist Two',
      art: 'https://i.scdn.co/image/abc',
    });
    expect(result.current.paused).toBe(false);
  });

  it('tracks pause and resume', async () => {
    const { result } = await renderReadyPlayer();

    emit('player_state_changed', playerState({ paused: true }));
    expect(result.current.paused).toBe(true);

    emit('player_state_changed', playerState({ paused: false }));
    expect(result.current.paused).toBe(false);
  });

  it('copes with a track that has no artwork', async () => {
    const { result } = await renderReadyPlayer();

    emit(
      'player_state_changed',
      playerState({
        track: { name: 'B-side', artists: [{ name: 'Artist' }], album: { images: [] } },
      }),
    );

    expect(result.current.track).toEqual({ name: 'B-side', artist: 'Artist', art: null });
  });

  it('clears the track when nothing is loaded on the device', async () => {
    const { result } = await renderReadyPlayer();
    emit('player_state_changed', playerState());

    emit('player_state_changed', playerState({ track: null }));

    expect(result.current.track).toBeNull();
  });

  it('ignores a null state instead of blanking what is showing', async () => {
    const { result } = await renderReadyPlayer();
    emit('player_state_changed', playerState());

    emit('player_state_changed', null);

    expect(result.current.track).toMatchObject({ name: 'Song Title' });
  });

  it('shows nothing as playing until the first state arrives', async () => {
    const { result } = await renderReadyPlayer();

    expect(result.current.track).toBeNull();
    expect(result.current.paused).toBe(true);
  });
});

describe('useSpotifyPlayer when the SDK reports a failure', () => {
  it('calls out a non-Premium account, the likeliest failure', async () => {
    const { result } = await renderPlayer();

    emit('account_error', { message: 'Premium required' });

    expect(result.current).toMatchObject({
      status: 'error',
      error: 'Premium required',
      premiumRequired: true,
    });
  });

  it('explains the Premium requirement even when Spotify sends no message', async () => {
    const { result } = await renderPlayer();

    emit('account_error', { message: '' });

    expect(result.current.error).toBe('Spotify Premium is required for in-page playback');
    expect(result.current.premiumRequired).toBe(true);
  });

  it('drops a session Spotify has rejected, so the widget stops retrying it', async () => {
    const { result } = await renderPlayer();

    emit('authentication_error', { message: 'Invalid token' });

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({
      status: 'error',
      error: 'Invalid token',
      premiumRequired: false,
    });
  });

  it('reports an initialisation failure', async () => {
    const { result } = await renderPlayer();

    emit('initialization_error', { message: 'EME not supported' });

    expect(result.current).toMatchObject({ status: 'error', error: 'EME not supported' });
  });

  it('falls back to its own wording when the SDK gives none', async () => {
    const { result } = await renderPlayer();

    emit('initialization_error', { message: '' });

    expect(result.current.error).toBe('The Spotify player could not start');
  });
});

describe('useSpotifyPlayer volume', () => {
  it('defaults to half', () => {
    const { result } = renderHook(() => useSpotifyPlayer());

    expect(result.current.volume).toBe(0.5);
  });

  it('sets it on the device and remembers it for next time', async () => {
    const { result } = await renderReadyPlayer();

    act(() => result.current.setVolume(0.8));

    expect(result.current.volume).toBe(0.8);
    expect(device.setVolume).toHaveBeenLastCalledWith(0.8);
    expect(JSON.parse(localStorage.getItem('spotify.volume')!)).toBe(0.8);
  });

  it('clamps a value above the maximum', async () => {
    const { result } = await renderReadyPlayer();

    act(() => result.current.setVolume(1.4));

    expect(result.current.volume).toBe(1);
  });

  it('clamps a value below zero', async () => {
    const { result } = await renderReadyPlayer();

    act(() => result.current.setVolume(-0.3));

    expect(result.current.volume).toBe(0);
  });

  it('still remembers the setting when there is no device to apply it to', () => {
    const { result } = renderHook(() => useSpotifyPlayer());

    act(() => result.current.setVolume(0.1));

    expect(result.current.volume).toBe(0.1);
  });
});

describe('useSpotifyPlayer transport controls', () => {
  it('drives play, next and previous on the device', async () => {
    const { result } = await renderReadyPlayer();

    act(() => result.current.togglePlay());
    act(() => result.current.next());
    act(() => result.current.previous());

    expect(device.togglePlay).toHaveBeenCalledTimes(1);
    expect(device.nextTrack).toHaveBeenCalledTimes(1);
    expect(device.previousTrack).toHaveBeenCalledTimes(1);
  });

  it('does nothing before a device exists', () => {
    vi.mocked(isConnected).mockReturnValue(false);
    const { result } = renderHook(() => useSpotifyPlayer());

    expect(() => {
      result.current.togglePlay();
      result.current.next();
      result.current.previous();
    }).not.toThrow();
  });

  it('swallows a rejected transport call rather than failing the widget', async () => {
    const { result } = await renderReadyPlayer();
    device.togglePlay.mockRejectedValue(new Error('Device gone'));

    act(() => result.current.togglePlay());

    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});

describe('useSpotifyPlayer play', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
  });

  /** The body of the playback request that was sent. */
  const sentBody = () => JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);

  it('asks Spotify to play on this device', async () => {
    const { result } = await renderReadyPlayer();

    act(() => result.current.play('spotify:track:abc', AS_TRACK));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.spotify.com/v1/me/player/play?device_id=device-1');
    expect(init).toMatchObject({
      method: 'PUT',
      headers: { Authorization: 'Bearer token-1', 'Content-Type': 'application/json' },
    });
  });

  it('queues a single track as a one-item queue', async () => {
    const { result } = await renderReadyPlayer();

    act(() => result.current.play('spotify:track:abc', AS_TRACK));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ uris: ['spotify:track:abc'] });
  });

  it('plays anything else as a browsable context', async () => {
    const { result } = await renderReadyPlayer();

    act(() => result.current.play('spotify:playlist:xyz', AS_CONTEXT));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ context_uri: 'spotify:playlist:xyz' });
  });

  it('does nothing until the device is registered', async () => {
    const { result } = await renderPlayer();

    act(() => result.current.play('spotify:track:abc', AS_TRACK));

    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a playback request that never lands', async () => {
    const { result } = await renderReadyPlayer();
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));

    act(() => result.current.play('spotify:track:abc', AS_TRACK));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Could not start playback on this device');
  });
});

describe('useSpotifyPlayer connect', () => {
  it('sends the user to Spotify’s consent screen', async () => {
    const { result } = await renderPlayer();

    act(() => result.current.connect());

    await waitFor(() => expect(beginAuth).toHaveBeenCalledTimes(1));
  });

  it('reports a flow that cannot even start', async () => {
    const { result } = await renderPlayer();
    vi.mocked(beginAuth).mockRejectedValue(new Error('Missing VITE_SPOTIFY_CLIENT_ID'));

    act(() => result.current.connect());

    await waitFor(() => expect(result.current.error).toBe('Missing VITE_SPOTIFY_CLIENT_ID'));
    expect(result.current.status).toBe('error');
  });
});

describe('useSpotifyPlayer signOut', () => {
  it('tears the device down and drops the session', async () => {
    const { result } = await renderReadyPlayer();

    act(() => result.current.signOut());

    expect(device.disconnect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({
      status: 'disconnected',
      deviceId: null,
      track: null,
      error: null,
      premiumRequired: false,
    });
  });

  it('clears a previous failure, so the widget offers to connect again', async () => {
    const { result } = await renderPlayer();
    emit('account_error', { message: 'Premium required' });

    act(() => result.current.signOut());

    expect(result.current).toMatchObject({
      status: 'disconnected',
      error: null,
      premiumRequired: false,
    });
  });

  it('leaves nothing behind for the transport controls to talk to', async () => {
    const { result } = await renderReadyPlayer();

    act(() => result.current.signOut());
    act(() => result.current.togglePlay());

    expect(device.togglePlay).not.toHaveBeenCalled();
  });
});

describe('loading the Web Playback SDK', () => {
  /**
   * `loadSdk` caches its `<script>` load for the page, so each of these tests needs
   * a module registry of its own — otherwise the first one's promise is reused.
   */
  async function renderPlayerAwaitingSdk() {
    vi.resetModules();
    delete window.Spotify;
    document.querySelectorAll(SDK_SCRIPT_SELECTOR).forEach((script) => script.remove());
    const { useSpotifyPlayer: freshHook } = await import('./useSpotifyPlayer');
    const view = renderHook(() => freshHook());
    const script = await waitFor(() => {
      const injected = document.querySelector<HTMLScriptElement>(SDK_SCRIPT_SELECTOR);
      expect(injected).not.toBeNull();
      return injected!;
    });
    return { ...view, script };
  }

  it('injects the SDK script and waits for its ready callback', async () => {
    const { result, script } = await renderPlayerAwaitingSdk();
    expect(script.src).toBe('https://sdk.scdn.co/spotify-player.js');
    expect(script.async).toBe(true);
    expect(result.current.status).toBe('connecting');

    installSdk();
    act(() => window.onSpotifyWebPlaybackSDKReady!());

    await waitFor(() => expect(constructPlayer).toHaveBeenCalledTimes(1));
  });

  it('reports a script that will not load', async () => {
    const { result, script } = await renderPlayerAwaitingSdk();

    act(() => script.onerror!(new Event('error')));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Failed to load the Spotify player');
  });

  it('reports a script that loads without installing its global', async () => {
    const { result } = await renderPlayerAwaitingSdk();

    act(() => window.onSpotifyWebPlaybackSDKReady!());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Spotify SDK loaded but the global is unavailable');
  });
});
