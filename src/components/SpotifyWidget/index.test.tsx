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

beforeEach(() => setPlayer());

describe('SpotifyWidget — embed fallback', () => {
  it('plays the default playlist in the embed iframe', () => {
    render(<SpotifyWidget />);
    const frame = screen.getByTitle("Spotify – Today's Top Hits");
    expect(frame).toHaveAttribute(
      'src',
      expect.stringContaining('open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M'),
    );
  });

  it('rejects a non-Spotify link with an error message', async () => {
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await user.click(screen.getByTitle(/Add a playlist/));
    await user.type(screen.getByPlaceholderText('Paste a Spotify link…'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText(/doesn.t look like a Spotify link/i)).toBeInTheDocument();
  });

  it('adds a source from a share URL and switches the player to it', async () => {
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await user.click(screen.getByTitle(/Add a playlist/));
    await user.type(screen.getByPlaceholderText('Name (optional)'), 'My Album');
    await user.type(
      screen.getByPlaceholderText('Paste a Spotify link…'),
      'https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3?si=abc',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const frame = screen.getByTitle('Spotify – My Album');
    expect(frame).toHaveAttribute(
      'src',
      expect.stringContaining('open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3'),
    );
    expect(localStorage.getItem('spotify.sources')).toContain('1DFixLWuPkv3KT3TnV35m3');
  });

  it('removes a source', async () => {
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await user.click(screen.getByRole('button', { name: /Remove Today's Top Hits/ }));
    expect(screen.queryByTitle("Spotify – Today's Top Hits")).not.toBeInTheDocument();
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
    expect(screen.getByTitle("Spotify – Today's Top Hits")).toBeInTheDocument();
  });

  it('falls back to the embed and explains when the account is not Premium', () => {
    setPlayer({ status: 'error', premiumRequired: true, error: 'Premium required' });
    render(<SpotifyWidget />);

    expect(screen.getByText(/needs Spotify Premium/i)).toBeInTheDocument();
    expect(screen.getByTitle("Spotify – Today's Top Hits")).toBeInTheDocument();
    expect(screen.queryByLabelText('Volume')).not.toBeInTheDocument();
  });
});

describe('SpotifyWidget — in-page player', () => {
  it('replaces the embed with the native player once a device is ready', () => {
    setPlayer(READY);
    render(<SpotifyWidget />);

    expect(screen.queryByTitle(/^Spotify – /)).not.toBeInTheDocument();
    expect(screen.getByText('Song Title')).toBeInTheDocument();
    expect(screen.getByText('Artist Name')).toBeInTheDocument();
  });

  it('renders the volume slider at the current level', () => {
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

  it('mutes to zero and restores the previous level on unmute', async () => {
    setPlayer({ ...READY, volume: 0.8 });
    const user = userEvent.setup();
    const { rerender } = render(<SpotifyWidget />);

    await user.click(screen.getByRole('button', { name: 'Mute' }));
    expect(player.setVolume).toHaveBeenCalledWith(0);

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

  it('drives the transport controls', async () => {
    setPlayer(READY);
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(player.togglePlay).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Next track' }));
    expect(player.next).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Previous track' }));
    expect(player.previous).toHaveBeenCalled();
  });

  it('labels the play button when paused', () => {
    setPlayer({ ...READY, paused: true });
    render(<SpotifyWidget />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('starts the selected source on this device as a context', async () => {
    setPlayer(READY);
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await user.click(screen.getByRole('button', { name: "Today's Top Hits" }));
    expect(player.play).toHaveBeenCalledWith('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', false);
  });

  it('plays a single track as a one-item queue rather than a context', async () => {
    setPlayer(READY);
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await user.click(screen.getByTitle(/Add a playlist/));
    await user.type(
      screen.getByPlaceholderText('Paste a Spotify link…'),
      'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(player.play).toHaveBeenCalledWith('spotify:track:4cOdK2wGLETKBW3PvgPWqT', true);
  });

  it('can disconnect the device', async () => {
    setPlayer(READY);
    const user = userEvent.setup();
    render(<SpotifyWidget />);

    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(player.signOut).toHaveBeenCalled();
  });
});
