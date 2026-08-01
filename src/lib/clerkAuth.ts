/**
 * Clerk configuration and the app's "is auth switched on?" predicate.
 *
 * Like the Google client id (ADR 0002), Clerk is **opt-in**: the app ships with
 * no key and runs exactly as it always has. Setting `VITE_CLERK_PUBLISHABLE_KEY`
 * turns the dashboard into a signed-in-only app. See ADR 0003.
 *
 * Clerk's React SDK talks to Clerk's hosted Frontend API directly from the
 * browser, so enabling auth does not introduce a backend — ADR 0001 still holds.
 */

/** The configured Clerk publishable key, or undefined when auth is off. */
export const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

/**
 * Whether a Clerk publishable key is configured.
 *
 * When this is `false` the app renders the dashboard directly, with no Clerk
 * provider mounted and no network calls to Clerk — the zero-setup path.
 */
export function hasClerkKey(): boolean {
  return typeof CLERK_PUBLISHABLE_KEY === 'string' && CLERK_PUBLISHABLE_KEY.length > 0;
}
