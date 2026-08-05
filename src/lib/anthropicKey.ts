/**
 * Where the Anthropic API key comes from, and — just as importantly — where it
 * must never go.
 *
 * A browser-only app cannot hold an API key secretly. Anything `VITE_`-prefixed
 * is inlined into the bundle at build time (the same reason ADR 0006 uses PKCE
 * rather than a Spotify client secret), so a key supplied that way is published
 * to anyone who opens the deployed JavaScript. This module therefore accepts a
 * key from two places, neither of which is the deploy pipeline:
 *
 * 1. **`VITE_ANTHROPIC_API_KEY` in `.env.local`** — gitignored, and deliberately
 *    *not* wired into `.github/workflows/deploy.yml`. It reaches a local
 *    `npm run dev` build and nothing else; the GitHub Pages copy sees it unset
 *    and renders the panel as unconfigured, exactly as Clerk and Google do.
 * 2. **Pasted at runtime** — held in `sessionStorage`, for using the panel on a
 *    deployed build without ever putting the key in a bundle.
 *
 * `sessionStorage` and not `localStorage`, for the reason ADR 0006 gives for the
 * Spotify token: it is dropped when the tab closes, so a shared browser does not
 * keep the credential. It is emphatically **not** written through
 * `useLocalStorage`, which would sweep it into the account-synced snapshot
 * (ADR 0008) and publish the key to Clerk's servers.
 */

/** The build-time key, when a local `.env.local` supplied one. */
const BUILT_IN = import.meta.env.VITE_ANTHROPIC_API_KEY;

/** `sessionStorage` slot for a key pasted at runtime. */
const SESSION_KEY = 'anthropic.apiKey';

/** Where a key came from, so the UI can explain itself. */
export type KeySource = 'env' | 'session' | 'none';

/** Reads the runtime-pasted key, if any. */
function fromSession(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    // Storage unavailable (private mode, blocked) — behave as if unset.
    return null;
  }
}

/**
 * The key to call Anthropic with, or `null` when there isn't one.
 *
 * The build-time key wins: someone who put a key in `.env.local` has already
 * chosen it for this machine, and a stale pasted value should not shadow it.
 */
export function anthropicKey(): string | null {
  const built = typeof BUILT_IN === 'string' && BUILT_IN.length > 0 ? BUILT_IN : null;
  return built ?? fromSession();
}

/** Where {@link anthropicKey} would get its value right now. */
export function keySource(): KeySource {
  if (typeof BUILT_IN === 'string' && BUILT_IN.length > 0) return 'env';
  return fromSession() ? 'session' : 'none';
}

/**
 * Stores a pasted key for this tab.
 *
 * @param key - The key to keep. Blank or whitespace clears it instead.
 */
export function setSessionKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) window.sessionStorage.setItem(SESSION_KEY, trimmed);
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to do — the caller will see `keySource()` stay 'none'.
  }
}

/** Forgets a pasted key. Has no effect on a key that came from the environment. */
export function clearSessionKey(): void {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Already unreachable; nothing to clear.
  }
}

/**
 * Whether a value looks like an Anthropic key, for immediate feedback on a
 * paste. Deliberately loose — the API is the real authority, and rejecting a
 * valid key because the prefix changed would be worse than letting a bad one
 * through to a clear 401.
 */
export function looksLikeKey(value: string): boolean {
  return /^sk-ant-\S{8,}$/.test(value.trim());
}
