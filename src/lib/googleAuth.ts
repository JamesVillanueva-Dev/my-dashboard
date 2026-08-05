/**
 * Minimal Google Identity Services (GIS) token-flow wrapper.
 *
 * This keeps the app client-only (ADR 0002): there is no backend and no client
 * secret. We use the GIS OAuth 2.0 *token* model, which is designed for browser
 * SPAs. The access token lives only in this module's memory for the tab's
 * lifetime — it is never written to `localStorage` — and expires after ~1 hour,
 * at which point a silent re-request renews it while the Google session is live.
 *
 * Tokens are tracked **per scope**, each with its own GIS client. A single client
 * covering every scope would mean anyone connecting their calendar was also asked
 * to hand over their mail, which is both a worse consent prompt and more access
 * than the feature needs. Scopes are requested only when the feature that needs
 * them is switched on (ADR 0009).
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/** Full Calendar scope — needed to create the dedicated calendar and its events. */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

/**
 * Read-only Gmail scope, for the mail panel.
 *
 * Google classes this as a **restricted** scope: an app that requests it from
 * the general public needs Google's verification and a third-party security
 * assessment. A project left in testing mode may use it with its own listed test
 * users, which is the mode this dashboard is built for.
 */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

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

/** Everything held for one OAuth scope. */
interface ScopeState {
  token: string | null;
  /** Epoch ms. */
  expiry: number;
  client: TokenClient | null;
  pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null;
}

const states = new Map<string, ScopeState>();

function stateFor(scope: string): ScopeState {
  let state = states.get(scope);
  if (!state) {
    state = { token: null, expiry: 0, client: null, pending: null };
    states.set(scope, state);
  }
  return state;
}

async function ensureClient(scope: string): Promise<TokenClient> {
  const state = stateFor(scope);
  if (state.client) return state.client;
  const oauth2 = await loadGis();
  state.client = oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID as string,
    scope,
    callback: (resp) => {
      const p = state.pending;
      state.pending = null;
      if (resp.error || !resp.access_token) {
        p?.reject(new Error(resp.error || 'No access token returned'));
        return;
      }
      state.token = resp.access_token;
      state.expiry = Date.now() + (resp.expires_in ?? 3600) * 1000;
      p?.resolve(resp.access_token);
    },
    error_callback: (err) => {
      const p = state.pending;
      state.pending = null;
      p?.reject(new Error(err.message || err.type || 'Google authorization was cancelled'));
    },
  });
  return state.client;
}

/**
 * Resolves a valid access token for `scope`, requesting one if the cached token
 * is missing or near expiry.
 *
 * @param interactive - Pass `true` for the first request in a session; it may
 *   open a Google consent popup, so it MUST be triggered by a user gesture
 *   (e.g. a button click). Pass `false` for background refreshes, which reuse
 *   the existing Google session silently and reject if that is not possible.
 *
 *   The two map onto GIS `prompt` values that both mean "don't nag": `''` shows
 *   a screen only when Google actually needs one — consent the first time, then
 *   nothing on later visits — while `'none'` forbids any UI at all. Notably `''`
 *   is *not* right for the background path even though it usually stays quiet,
 *   because the one time it does decide to prompt is a popup with no user
 *   gesture behind it, which browsers block.
 * @param scope - Which OAuth scope to authorize. Defaults to
 *   {@link CALENDAR_SCOPE}, so existing calendar callers are unchanged.
 * @returns A bearer access token good for that scope's Google API.
 */
export async function getAccessToken(
  interactive: boolean,
  scope: string = CALENDAR_SCOPE,
): Promise<string> {
  if (!hasGoogleClientId()) throw new Error('Missing VITE_GOOGLE_CLIENT_ID');
  const state = stateFor(scope);
  if (state.token && Date.now() < state.expiry - 60_000) return state.token;

  const client = await ensureClient(scope);
  return new Promise<string>((resolve, reject) => {
    state.pending = { resolve, reject };
    client.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

/**
 * Forgets a cached token (used when disconnecting).
 *
 * @param scope - The scope to forget. Omit to forget every scope — but prefer
 *   naming one: disconnecting the calendar should not silently revoke the mail
 *   panel's access, and vice versa.
 */
export function clearAccessToken(scope?: string): void {
  const forget = (state: ScopeState) => {
    state.token = null;
    state.expiry = 0;
  };
  if (scope === undefined) states.forEach(forget);
  else forget(stateFor(scope));
}
