/**
 * Minimal Google Identity Services (GIS) token-flow wrapper.
 *
 * This keeps the app client-only (ADR 0002): there is no backend and no client
 * secret. We use the GIS OAuth 2.0 *token* model, which is designed for browser
 * SPAs. The access token lives only in this module's memory for the tab's
 * lifetime — it is never written to `localStorage` — and expires after ~1 hour,
 * at which point a silent re-request renews it while the Google session is live.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/** Full Calendar scope — needed to create the dedicated calendar and its events. */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
}
interface OAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (resp: TokenResponse) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  }): TokenClient;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: OAuth2 } };
  }
}

/** The configured OAuth client id, or undefined when the app is unconfigured. */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

/** Whether a Google client id is configured; gates all Calendar UI. */
export function hasGoogleClientId(): boolean {
  return typeof GOOGLE_CLIENT_ID === 'string' && GOOGLE_CLIENT_ID.length > 0;
}

let gisPromise: Promise<OAuth2> | null = null;
function loadGis(): Promise<OAuth2> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<OAuth2>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new Error('Google Identity Services loaded but oauth2 is unavailable'));
    };
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
  return gisPromise;
}

let accessToken: string | null = null;
let tokenExpiry = 0; // epoch ms
let tokenClient: TokenClient | null = null;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

async function ensureClient(): Promise<TokenClient> {
  if (tokenClient) return tokenClient;
  const oauth2 = await loadGis();
  tokenClient = oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID as string,
    scope: CALENDAR_SCOPE,
    callback: (resp) => {
      const p = pending;
      pending = null;
      if (resp.error || !resp.access_token) {
        p?.reject(new Error(resp.error || 'No access token returned'));
        return;
      }
      accessToken = resp.access_token;
      tokenExpiry = Date.now() + (resp.expires_in ?? 3600) * 1000;
      p?.resolve(accessToken);
    },
    error_callback: (err) => {
      const p = pending;
      pending = null;
      p?.reject(new Error(err.message || err.type || 'Google authorization was cancelled'));
    },
  });
  return tokenClient;
}

/**
 * Resolves a valid Calendar access token, requesting one if the cached token is
 * missing or near expiry.
 *
 * @param interactive - Pass `true` for the first request in a session; it may
 *   open a Google consent popup, so it MUST be triggered by a user gesture
 *   (e.g. a button click). Pass `false` for background refreshes, which reuse
 *   the existing Google session silently and reject if that is not possible.
 * @returns A bearer access token for `https://www.googleapis.com/calendar/v3`.
 */
export async function getAccessToken(interactive: boolean): Promise<string> {
  if (!hasGoogleClientId()) throw new Error('Missing VITE_GOOGLE_CLIENT_ID');
  if (accessToken && Date.now() < tokenExpiry - 60_000) return accessToken;

  const client = await ensureClient();
  return new Promise<string>((resolve, reject) => {
    pending = { resolve, reject };
    client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

/** Forgets the in-memory token (used when disconnecting). */
export function clearAccessToken(): void {
  accessToken = null;
  tokenExpiry = 0;
}
