import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SpotifyWidget from './index';
import type { SpotifyPlayer } from '../../hooks/useSpotifyPlayer';

// The widget is driven entirely by this hook, and the real one loads Spotify's
// SDK over the network. Mocking it lets each test place the player in a specific
// state — off, ready, non-Premium — without any of that machinery.
const { player } = vi.hoisted(() => ({
  player: {} as SpotifyPlayer,
}));
vi.mock('../../hooks/useSpotifyPlayer', () => ({ useSpotifyPlayer: () => player }));

/** What `play` is told about the URI it is given. */
const AS_TRACK = true;
const AS_CONTEXT = false;

/** The playlist the widget ships with. */
const DEFAULT_PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M';

/** Resets the mock player, applying any overrides for the test at hand. */
function setPlayer(overrides: Partial<SpotifyPlayer> = {}) {
  Object.assign(
    player,
    {
      status: 'off',
      error: null,
      premiumRequired: false,
      deviceId: null,
      track: null,
      paused: true,
      volume: 0.5,
      setVolume: vi.fn(),
      togglePlay: vi.fn(),
      next: vi.fn(),
      previous: vi.fn(),
      connect: vi.fn(),
      signOut: vi.fn(),
      play: vi.fn(),
    } satisfies SpotifyPlayer,
    overrides,
  );
}

/** The player state used by the in-page-player tests. */
const READY: Partial<SpotifyPlayer> = {
  status: 'ready',
  deviceId: 'device-1',
  paused: false,
  track: { name: 'Song Title', artist: 'Artist Name', art: 'https://i.scdn.co/image/abc' },
};

/** Adds a source through the paste-a-link popover. */
async function addSource(
  user: ReturnType<typeof userEvent.setup>,
  link: string,
  name?: string,
) {
  await user.click(screen.getByTitle(/Add a playlist/));
  if (name) await user.type(screen.getByPlaceholderText('Name (optional)'), name);
  await user.type(screen.getByPlaceholderText('Paste a Spotify link…'), link);
  await user.click(screen.getByRole('button', { name: 'Save' }));
}

/** The embed iframe for the default playlist. */
const defaultEmbed = () => screen.queryByTitle("Spotify – Today's Top Hits");

beforeEach(() => setPlayer());

describe('SpotifyWidget embed fallback', () => {
  it('plays the default playlist in the embed iframe', () => {
    render(<SpotifyWidget />);

    expect(defaultEmbed()).toHaveAttribute(
      'src',
      expect.stringContaining(`open.spotify.com/embed/playlist/${DEFAULT_PLAYLIST_ID}`),
    );
  });

  it('shows no volume control when the integration is switched off', () => {
    render(<SpotifyWidget />);

    expect(screen.queryByLabelText('Volume')).not.toBeInTheDocument();
  });

  it('offers to connect when configured but not signed in', async () => {
    setPlayer({ status: 'disconnected' });
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await user.click(screen.getByRole('button', { name: /Connect Spotify Premium/i }));

    expect(player.connect).toHaveBeenCalled();
    // Still the embed until a device is live.
    expect(defaultEmbed()).toBeInTheDocument();
  });

  it('falls back to the embed and explains when the account is not Premium', () => {
    setPlayer({ status: 'error', premiumRequired: true, error: 'Premium required' });

    render(<SpotifyWidget />);

    expect(screen.getByText(/needs Spotify Premium/i)).toBeInTheDocument();
    expect(defaultEmbed()).toBeInTheDocument();
    expect(screen.queryByLabelText('Volume')).not.toBeInTheDocument();
  });
});

describe('SpotifyWidget sources', () => {
  it('rejects a non-Spotify link with an error message', async () => {
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await addSource(user, 'https://example.com');

    expect(screen.getByText(/doesn.t look like a Spotify link/i)).toBeInTheDocument();
  });

  it('adds a source from a share URL and switches the player to it', async () => {
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await addSource(
      user,
      'https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3?si=abc',
      'My Album',
    );

    expect(screen.getByTitle('Spotify – My Album')).toHaveAttribute(
      'src',
      expect.stringContaining('open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3'),
    );
  });

  it('persists the source it added', async () => {
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await addSource(user, 'https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3?si=abc');

    expect(localStorage.getItem('spotify.sources')).toContain('1DFixLWuPkv3KT3TnV35m3');
  });

  it('removes a source', async () => {
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await user.click(screen.getByRole('button', { name: /Remove Today's Top Hits/ }));

    expect(defaultEmbed()).not.toBeInTheDocument();
  });
});

describe('SpotifyWidget in-page player', () => {
  it('replaces the embed with the native player once a device is ready', () => {
    setPlayer(READY);

    render(<SpotifyWidget />);

    expect(screen.queryByTitle(/^Spotify – /)).not.toBeInTheDocument();
    expect(screen.getByText('Song Title')).toBeInTheDocument();
    expect(screen.getByText('Artist Name')).toBeInTheDocument();
  });

  it('labels the pause button while playing', () => {
    setPlayer({ ...READY, paused: false });

    render(<SpotifyWidget />);

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('labels the play button when paused', () => {
    setPlayer({ ...READY, paused: true });

    render(<SpotifyWidget />);

    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('drives the transport controls', async () => {
    setPlayer(READY);
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await user.click(screen.getByRole('button', { name: 'Next track' }));
    await user.click(screen.getByRole('button', { name: 'Previous track' }));

    expect(player.togglePlay).toHaveBeenCalled();
    expect(player.next).toHaveBeenCalled();
    expect(player.previous).toHaveBeenCalled();
  });

  it('can disconnect the device', async () => {
    setPlayer(READY);
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await user.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(player.signOut).toHaveBeenCalled();
  });
});

describe('SpotifyWidget volume', () => {
  it('renders the slider at the current level', () => {
    setPlayer({ ...READY, volume: 0.7 });

    render(<SpotifyWidget />);

    expect(screen.getByLabelText('Volume')).toHaveValue('0.7');
    expect(screen.getByText('70%')).toBeInTheDocument();
  });

  it('sets the volume when the slider moves', () => {
    setPlayer(READY);
    render(<SpotifyWidget />);

    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '0.25' } });

    expect(player.setVolume).toHaveBeenCalledWith(0.25);
  });

  it('mutes to zero', async () => {
    setPlayer({ ...READY, volume: 0.8 });
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await user.click(screen.getByRole('button', { name: 'Mute' }));

    expect(player.setVolume).toHaveBeenCalledWith(0);
  });

  it('restores the previous level on unmute', async () => {
    setPlayer({ ...READY, volume: 0.8 });
    const user = userEvent.setup();
    const { rerender } = render(<SpotifyWidget />);
    await user.click(screen.getByRole('button', { name: 'Mute' }));

    // Re-render as the hook would once the volume actually reached zero.
    Object.assign(player, { volume: 0 });
    rerender(<SpotifyWidget />);
    await user.click(screen.getByRole('button', { name: 'Unmute' }));

    expect(player.setVolume).toHaveBeenLastCalledWith(0.8);
  });

  it('shows the muted icon and 0% at zero volume', () => {
    setPlayer({ ...READY, volume: 0 });

    render(<SpotifyWidget />);

    expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });
});

describe('SpotifyWidget starting playback on the device', () => {
  it('starts the selected source as a browsable context', async () => {
    setPlayer(READY);
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await user.click(screen.getByRole('button', { name: "Today's Top Hits" }));

    expect(player.play).toHaveBeenCalledWith(`spotify:playlist:${DEFAULT_PLAYLIST_ID}`, AS_CONTEXT);
  });

  it('plays a single track as a one-item queue rather than a context', async () => {
    setPlayer(READY);
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await addSource(user, 'spotify:track:4cOdK2wGLETKBW3PvgPWqT');

    expect(player.play).toHaveBeenCalledWith('spotify:track:4cOdK2wGLETKBW3PvgPWqT', AS_TRACK);
  });
});
