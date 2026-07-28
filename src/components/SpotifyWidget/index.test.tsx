import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SpotifyWidget from './SpotifyWidget';

describe('SpotifyWidget', () => {
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
});
