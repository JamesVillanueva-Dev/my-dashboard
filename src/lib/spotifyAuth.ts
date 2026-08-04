/**
 * Spotify OAuth via Authorization Code with PKCE.
 *
 * Like the Google and Clerk integrations, this is **opt-in**: with no
 * `VITE_SPOTIFY_CLIENT_ID` the widget keeps using the anonymous iframe embed and
 * none of this code runs. See ADR 0006.
 *
 * PKCE rather than the implicit grant because Spotify removed implicit support,
 * and PKCE is the flow designed for public clients — it needs no client secret,
 * which matters here since anything `VITE_`-prefixed is inlined into the browser
 * bundle and would be published rather than protected (ADR 0001).
 *
 * ## Where the tokens live
 *
 * `sessionStorage`, not `localStorage`. The redirect flow navigates away from the
 * page and back, so a purely in-memory token like `googleAuth.ts` keeps would not
 * survive the round trip that creates it. `sessionStorage` is the narrowest thing
 * that does: it survives the redirect and reloads within the tab, and is dropped
 * when the tab closes, so a shared browser does not leave a Spotify session
 * behind. It is deliberately *not* `localStorage`, which would outlive the
 * browsing session and sit alongside the dashboard's own persisted data.
 */

/** Scopes needed to run a Web Playback SDK device and drive it. */
export const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

/** Keys under which the flow's state is held for the tab. */
const VERIFIER_KEY = 'spotify.pkce_verifier';
const TOKEN_KEY = 'spotify.token';

/** The configured Spotify client id, or undefined when the integration is off. */
export const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;

/**
 * Whether a Spotify client id is configured.
 *
 * When `false` the widget renders exactly as it always has — the anonymous embed
 * — and never asks the user to connect anything.
 */
export function hasSpotifyClientId(): boolean {
  return typeof SPOTIFY_CLIENT_ID === 'string' && SPOTIFY_CLIENT_ID.length > 0;
}

/**
 * The redirect target registered in the Spotify dashboard.
 *
 * Derived from the current location rather than hard-coded so the same build
 * works on `localhost:5173` and under the GitHub Pages base path. Query and hash
 * are stripped: Spotify requires an exact match against the registered URI.
 */
export function redirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/** A token as persisted for the tab. */
interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms after which the access token should be refreshed. */
  expiresAt: number;
}

function readToken(): StoredToken | null {
  try {
    const raw = window.sessionStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch {
    return null;
  }
}

function writeToken(token: StoredToken | null): void {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode, quota). The flow still works for this
    // page view; the user just re-connects after a reload.
  }
}

/** Whether a Spotify session is currently held for this tab. */
export function isConnected(): boolean {
  return readToken() !== null;
}

/** Random URL-safe string used as the PKCE code verifier. */
function randomVerifier(length = 64): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** base64url(SHA-256(input)) — the PKCE `code_challenge`. */
async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Starts the OAuth flow by navigating to Spotify's consent screen.
 *
 * Must be called from a user gesture. The page navigates away; the caller does
 * not resume. On return, {@link completeAuthFromRedirect} finishes the exchange.
 */
export async function beginAuth(): Promise<void> {
  if (!hasSpotifyClientId()) throw new Error('Missing VITE_SPOTIFY_CLIENT_ID');

  const verifier = randomVerifier();
  window.sessionStorage.setItem(VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID as string,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
  });
  window.location.assign(`${AUTHORIZE_URL}?${params}`);
}

/** Shape of Spotify's token endpoint response. */
interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function exchange(body: Record<string, string>): Promise<StoredToken> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID as string, ...body }),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Spotify token request failed');
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

/**
 * Completes the flow if the current URL carries Spotify's `?code=`.
 *
 * Safe to call on every mount: it returns `false` immediately when the URL holds
 * no authorization code, so it costs nothing on an ordinary page load. On
 * success the code is stripped from the address bar, since an authorization code
 * is single-use and should not linger in history or be re-submitted on reload.
 *
 * @returns `true` when a redirect was consumed and a session is now held.
 */
export async function completeAuthFromRedirect(): Promise<boolean> {
  if (!hasSpotifyClientId()) return false;

  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const failed = url.searchParams.get('error');
  const verifier = window.sessionStorage.getItem(VERIFIER_KEY);

  if (!code && !failed) return false;

  // Clear the query either way — a denied consent should not replay on reload.
  url.searchParams.delete('code');
  url.searchParams.delete('error');
  url.searchParams.delete('state');
  window.history.replaceState({}, '', url.toString());
  window.sessionStorage.removeItem(VERIFIER_KEY);

  if (failed || !code || !verifier) return false;

  const token = await exchange({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  writeToken(token);
  return true;
}

/**
 * Returns a valid access token, refreshing it when it is close to expiry.
 *
 * This is what the Web Playback SDK's `getOAuthToken` callback ends up calling,
 * so it must never prompt: if no session is held, or the refresh fails, it
 * throws and the caller falls back to the anonymous embed.
 */
export async function getAccessToken(): Promise<string> {
  const token = readToken();
  if (!token) throw new Error('Not connected to Spotify');

  if (Date.now() < token.expiresAt - 60_000) return token.accessToken;

  if (!token.refreshToken) {
    disconnect();
    throw new Error('Spotify session expired');
  }
  try {
    const next = await exchange({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
    });
    // Spotify may omit a new refresh token; keep the existing one if so.
    writeToken({ ...next, refreshToken: next.refreshToken ?? token.refreshToken });
    return next.accessToken;
  } catch (e) {
    disconnect();
    throw e instanceof Error ? e : new Error('Spotify token refresh failed');
  }
}

/** Drops the tab's Spotify session. */
export function disconnect(): void {
  writeToken(null);
}
