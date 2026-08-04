import { describe, it, expect, beforeEach } from 'vitest';
import {
  completeAuthFromRedirect,
  disconnect,
  getAccessToken,
  hasSpotifyClientId,
  isConnected,
  redirectUri,
  SPOTIFY_SCOPES,
} from './spotifyAuth';

/** Puts a token into the tab's session, as a completed OAuth flow would. */
function seedSession(expiresAt: number, refreshToken?: string) {
  sessionStorage.setItem(
    'spotify.token',
    JSON.stringify({ accessToken: 'tok', refreshToken, expiresAt }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('spotifyAuth', () => {
  it('is switched off when no client id is configured', () => {
    // The suite forces VITE_SPOTIFY_CLIENT_ID empty (see vite.config.ts), which
    // is the default zero-setup state the dashboard ships in.
    expect(hasSpotifyClientId()).toBe(false);
  });

  it('requests the scopes the Web Playback SDK needs', () => {
    // `streaming` is what permits an in-page device at all; the playback-state
    // pair is what lets the widget start and read that device.
    expect(SPOTIFY_SCOPES).toContain('streaming');
    expect(SPOTIFY_SCOPES).toContain('user-modify-playback-state');
    expect(SPOTIFY_SCOPES).toContain('user-read-playback-state');
  });

  it('derives a redirect uri with no query or hash', () => {
    window.history.replaceState({}, '', '/dash?code=leftover#frag');
    const uri = redirectUri();
    expect(uri).not.toContain('?');
    expect(uri).not.toContain('#');
    expect(uri).toContain('/dash');
  });

  it('reports no session before any flow has run', () => {
    expect(isConnected()).toBe(false);
  });

  it('treats a stored token as a live session', () => {
    seedSession(Date.now() + 3_600_000);
    expect(isConnected()).toBe(true);
  });

  it('does nothing on an ordinary page load with no authorization code', async () => {
    await expect(completeAuthFromRedirect()).resolves.toBe(false);
  });

  it('returns an unexpired access token without hitting the network', async () => {
    seedSession(Date.now() + 3_600_000);
    await expect(getAccessToken()).resolves.toBe('tok');
  });

  it('rejects when no session is held', async () => {
    await expect(getAccessToken()).rejects.toThrow(/not connected/i);
  });

  it('drops an expired session that has no refresh token', async () => {
    seedSession(Date.now() - 1000);
    await expect(getAccessToken()).rejects.toThrow(/expired/i);
    // The dead session is cleared rather than left to fail on every call.
    expect(isConnected()).toBe(false);
  });

  it('forgets the session on disconnect', () => {
    seedSession(Date.now() + 3_600_000);
    disconnect();
    expect(isConnected()).toBe(false);
  });

  it('never writes the session to localStorage', () => {
    seedSession(Date.now() + 3_600_000);
    expect(localStorage.getItem('spotify.token')).toBeNull();
    expect(Object.keys(localStorage)).not.toContain('spotify.token');
  });
});
