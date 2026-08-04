import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const CLIENT_ID = 'client-123.apps.googleusercontent.com';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

/**
 * The client id is captured at module load and the access token is module
 * state, so every case re-imports the module with its own environment — that is
 * also what gives each test a cold token cache.
 */
async function loadWith(clientId: string) {
  vi.resetModules();
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', clientId);
  return import('./googleAuth');
}

/** A stand-in for the Google Identity Services `oauth2` object. */
function installGis() {
  let config: {
    client_id: string;
    scope: string;
    callback: (resp: TokenResponse) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  };

  const gis = {
    /** What the next `requestAccessToken` call answers with. */
    next: { access_token: 'token-abc', expires_in: 3600 } as TokenResponse | null,
    /** When set, the next request fails through the error callback instead. */
    nextError: null as { type?: string; message?: string } | null,
    requestAccessToken: vi.fn((opts?: { prompt?: string }) => {
      void opts;
      queueMicrotask(() => {
        if (gis.nextError) config.error_callback?.(gis.nextError);
        else if (gis.next) config.callback(gis.next);
      });
    }),
    initTokenClient: vi.fn((c: typeof config) => {
      config = c;
      return { requestAccessToken: gis.requestAccessToken };
    }),
  };

  window.google = { accounts: { oauth2: { initTokenClient: gis.initTokenClient } } };
  return gis;
}

/** The prompt passed to the most recent token request. */
function lastPrompt(gis: ReturnType<typeof installGis>) {
  return gis.requestAccessToken.mock.calls.at(-1)?.[0]?.prompt;
}

beforeEach(() => {
  delete window.google;
  document.querySelectorAll('script[src*="gsi/client"]').forEach((s) => s.remove());
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.google;
});

describe('hasGoogleClientId', () => {
  it('is off when no client id is configured', async () => {
    const { hasGoogleClientId } = await loadWith('');

    expect(hasGoogleClientId()).toBe(false);
  });

  it('is on once a client id is set', async () => {
    const { hasGoogleClientId, GOOGLE_CLIENT_ID } = await loadWith(CLIENT_ID);

    expect(hasGoogleClientId()).toBe(true);
    expect(GOOGLE_CLIENT_ID).toBe(CLIENT_ID);
  });
});

describe('CALENDAR_SCOPE', () => {
  it('asks for full Calendar access, which the sync path needs to write', async () => {
    const { CALENDAR_SCOPE } = await loadWith(CLIENT_ID);

    expect(CALENDAR_SCOPE).toBe('https://www.googleapis.com/auth/calendar');
  });
});

describe('getAccessToken', () => {
  it('refuses to try when the app is unconfigured', async () => {
    const { getAccessToken } = await loadWith('');

    await expect(getAccessToken(true)).rejects.toThrow('Missing VITE_GOOGLE_CLIENT_ID');
  });

  it('resolves a token from the consent flow', async () => {
    installGis();
    const { getAccessToken } = await loadWith(CLIENT_ID);

    await expect(getAccessToken(true)).resolves.toBe('token-abc');
  });

  it('initialises the client with the configured id and the Calendar scope', async () => {
    const gis = installGis();
    const { getAccessToken, CALENDAR_SCOPE } = await loadWith(CLIENT_ID);

    await getAccessToken(true);

    expect(gis.initTokenClient).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: CLIENT_ID, scope: CALENDAR_SCOPE }),
    );
  });

  it('asks for consent on an interactive request', async () => {
    const gis = installGis();
    const { getAccessToken } = await loadWith(CLIENT_ID);

    await getAccessToken(true);

    expect(lastPrompt(gis)).toBe('consent');
  });

  it('stays silent on a background refresh, so no popup can appear', async () => {
    const gis = installGis();
    const { getAccessToken } = await loadWith(CLIENT_ID);

    await getAccessToken(false);

    expect(lastPrompt(gis)).toBe('');
  });

  it('rejects when Google returns an error', async () => {
    const gis = installGis();
    gis.next = { error: 'access_denied' };
    const { getAccessToken } = await loadWith(CLIENT_ID);

    await expect(getAccessToken(true)).rejects.toThrow('access_denied');
  });

  it('rejects when the response carries no token', async () => {
    const gis = installGis();
    gis.next = {};
    const { getAccessToken } = await loadWith(CLIENT_ID);

    await expect(getAccessToken(true)).rejects.toThrow('No access token returned');
  });

  it('rejects when the user dismisses the popup', async () => {
    const gis = installGis();
    gis.nextError = { type: 'popup_closed', message: 'Popup window closed' };
    const { getAccessToken } = await loadWith(CLIENT_ID);

    await expect(getAccessToken(true)).rejects.toThrow('Popup window closed');
  });

  it('falls back to the error type when there is no message', async () => {
    const gis = installGis();
    gis.nextError = { type: 'popup_failed_to_open' };
    const { getAccessToken } = await loadWith(CLIENT_ID);

    await expect(getAccessToken(true)).rejects.toThrow('popup_failed_to_open');
  });

  it('recovers after a rejection, rather than staying stuck on the failed request', async () => {
    const gis = installGis();
    gis.nextError = { type: 'popup_closed' };
    const { getAccessToken } = await loadWith(CLIENT_ID);
    await expect(getAccessToken(true)).rejects.toThrow();

    gis.nextError = null;
    await expect(getAccessToken(true)).resolves.toBe('token-abc');
  });

  describe('caching', () => {
    it('reuses a live token instead of asking Google again', async () => {
      const gis = installGis();
      const { getAccessToken } = await loadWith(CLIENT_ID);

      await getAccessToken(true);
      await expect(getAccessToken(false)).resolves.toBe('token-abc');

      expect(gis.requestAccessToken).toHaveBeenCalledTimes(1);
      // The client is built once and kept.
      expect(gis.initTokenClient).toHaveBeenCalledTimes(1);
    });

    it('renews a token that is about to expire', async () => {
      const gis = installGis();
      // Inside the one-minute safety margin, so it counts as spent.
      gis.next = { access_token: 'nearly-done', expires_in: 30 };
      const { getAccessToken } = await loadWith(CLIENT_ID);

      await getAccessToken(true);
      gis.next = { access_token: 'renewed', expires_in: 3600 };
      await expect(getAccessToken(false)).resolves.toBe('renewed');

      expect(gis.requestAccessToken).toHaveBeenCalledTimes(2);
    });

    it('defaults to an hour when Google does not say how long the token lasts', async () => {
      const gis = installGis();
      gis.next = { access_token: 'token-abc' };
      const { getAccessToken } = await loadWith(CLIENT_ID);

      await getAccessToken(true);
      await getAccessToken(false);

      expect(gis.requestAccessToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearAccessToken', () => {
    it('forces the next call to request a fresh token', async () => {
      const gis = installGis();
      const { getAccessToken, clearAccessToken } = await loadWith(CLIENT_ID);
      await getAccessToken(true);

      clearAccessToken();
      await getAccessToken(false);

      expect(gis.requestAccessToken).toHaveBeenCalledTimes(2);
    });

    it('is safe to call when there was no token', async () => {
      const { clearAccessToken } = await loadWith(CLIENT_ID);

      expect(() => clearAccessToken()).not.toThrow();
    });
  });

  describe('loading Google Identity Services', () => {
    /** Waits for the injected GIS script tag to appear. */
    async function pendingScript() {
      return vi.waitFor(() => {
        const script = document.querySelector<HTMLScriptElement>('script[src*="gsi/client"]');
        if (!script) throw new Error('script not injected yet');
        return script;
      });
    }

    it('injects the script when GIS is not already on the page', async () => {
      const { getAccessToken } = await loadWith(CLIENT_ID);
      const pending = getAccessToken(true);

      const script = await pendingScript();
      expect(script.src).toBe('https://accounts.google.com/gsi/client');
      expect(script.async).toBe(true);

      installGis();
      script.onload!(new Event('load'));

      await expect(pending).resolves.toBe('token-abc');
    });

    it('rejects when the script cannot be fetched', async () => {
      const { getAccessToken } = await loadWith(CLIENT_ID);
      const pending = getAccessToken(true);

      const script = await pendingScript();
      script.onerror!(new Event('error'));

      await expect(pending).rejects.toThrow('Failed to load Google Identity Services');
    });

    it('rejects when the script loads but exposes no oauth2', async () => {
      const { getAccessToken } = await loadWith(CLIENT_ID);
      const pending = getAccessToken(true);

      const script = await pendingScript();
      script.onload!(new Event('load'));

      await expect(pending).rejects.toThrow(
        'Google Identity Services loaded but oauth2 is unavailable',
      );
    });

    it('does not inject the script when GIS is already present', async () => {
      installGis();
      const { getAccessToken } = await loadWith(CLIENT_ID);

      await getAccessToken(true);

      expect(document.querySelector('script[src*="gsi/client"]')).toBeNull();
    });
  });
});
