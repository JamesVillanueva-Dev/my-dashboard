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

const HOUR = 3_600_000;

/** Puts a token into the tab's session, as a completed OAuth flow would. */
function seedSession(expiresAt: number, refreshToken?: string) {
  sessionStorage.setItem(
    'spotify.token',
    JSON.stringify({ accessToken: 'tok', refreshToken, expiresAt }),
  );
}

/** Seeds a session with an hour left to run. */
function seedLiveSession() {
  seedSession(Date.now() + HOUR);
}

/** Seeds a session that has already expired and has no refresh token. */
function seedExpiredSession() {
  seedSession(Date.now() - 1000);
}

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('hasSpotifyClientId', () => {
  it('is false when no client id is configured', () => {
    // The suite forces VITE_SPOTIFY_CLIENT_ID empty (see vite.config.ts), which
    // is the default zero-setup state the dashboard ships in.
    expect(hasSpotifyClientId()).toBe(false);
  });
});

describe('SPOTIFY_SCOPES', () => {
  it('requests the scopes the Web Playback SDK needs', () => {
    // `streaming` is what permits an in-page device at all; the playback-state
    // pair is what lets the widget start and read that device.
    expect(SPOTIFY_SCOPES).toContain('streaming');
    expect(SPOTIFY_SCOPES).toContain('user-modify-playback-state');
    expect(SPOTIFY_SCOPES).toContain('user-read-playback-state');
  });
});

describe('redirectUri', () => {
  it('drops any query and hash from the current location', () => {
    window.history.replaceState({}, '', '/dash?code=leftover#frag');

    const uri = redirectUri();

    expect(uri).not.toContain('?');
    expect(uri).not.toContain('#');
    expect(uri).toContain('/dash');
  });
});

describe('isConnected', () => {
  it('is false before any flow has run', () => {
    expect(isConnected()).toBe(false);
  });

  it('is true while a token is held', () => {
    seedLiveSession();

    expect(isConnected()).toBe(true);
  });
});

describe('completeAuthFromRedirect', () => {
  it('does nothing on an ordinary page load with no authorization code', async () => {
    await expect(completeAuthFromRedirect()).resolves.toBe(false);
  });
});

describe('getAccessToken', () => {
  it('returns an unexpired token without hitting the network', async () => {
    seedLiveSession();

    await expect(getAccessToken()).resolves.toBe('tok');
  });

  it('rejects when no session is held', async () => {
    await expect(getAccessToken()).rejects.toThrow(/not connected/i);
  });

  it('rejects when the session has expired and cannot be refreshed', async () => {
    seedExpiredSession();

    await expect(getAccessToken()).rejects.toThrow(/expired/i);
  });

  it('drops an expired session rather than leaving it to fail on every call', async () => {
    seedExpiredSession();

    await expect(getAccessToken()).rejects.toThrow();

    expect(isConnected()).toBe(false);
  });
});

describe('disconnect', () => {
  it('forgets the session', () => {
    seedLiveSession();

    disconnect();

    expect(isConnected()).toBe(false);
  });
});

describe('where the session is kept', () => {
  it('is never written to localStorage', () => {
    seedLiveSession();

    expect(localStorage.getItem('spotify.token')).toBeNull();
    expect(Object.keys(localStorage)).not.toContain('spotify.token');
  });
});
