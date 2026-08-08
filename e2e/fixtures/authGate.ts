import type { Page } from '@playwright/test';

/**
 * Turning the sign-in gate back on, from the browser.
 *
 * The dev server runs with `VITE_CLERK_PUBLISHABLE_KEY` blanked, because Clerk
 * refuses to load in an automated browser and with a key set `AuthGate` renders
 * the landing page instead of the dashboard — so every other spec would have
 * nothing to test. But that also puts the landing page, the demo, and the whole
 * signed-out path out of reach, and the demo is real application code with real
 * storage consequences (`seedDemo`, `clearDemo`, `DEMO_SCOPE`).
 *
 * So the two modules that decide "is auth on" are replaced with stubs, served by
 * `page.route` over Vite's own module URLs. Nothing in `src/` or `vite.config.ts`
 * changes, and no second dev server is needed.
 *
 * **What this does and does not prove.** The gate, the landing page, the demo
 * seeding and clearing, and the storage scoping are all the real thing. Clerk
 * itself is not exercised at all — signing in stays out of scope for exactly the
 * reasons the plan gives. A spec here can prove the demo is namespaced and
 * cleaned up; it cannot prove anything about Clerk's own behaviour.
 */

/** Replaces `src/lib/clerkAuth.ts` so `hasClerkKey()` answers yes. */
const CLERK_AUTH = `
export const CLERK_PUBLISHABLE_KEY = 'pk_test_e2e';
export function hasClerkKey() { return true; }
`;

/**
 * Replaces `@clerk/clerk-react` with the smallest module the app's four import
 * sites can run against.
 *
 * No React import: a component that returns its own children is a plain
 * function, so this stays valid ESM the browser can execute as served. The
 * signed-out branch is the only one wired up, which is the branch the demo lives
 * on — `SignedIn` renders nothing, as it would for a visitor with no session.
 */
const CLERK_REACT = `
export const ClerkProvider = ({ children }) => children;
export const SignedOut = ({ children }) => children;
export const SignedIn = () => null;
export const SignIn = () => null;
export const UserButton = () => null;
export const useUser = () => ({ user: null, isLoaded: true, isSignedIn: false });
`;

/**
 * Serves the stubs above in place of the real modules.
 *
 * Registered after `stubNetwork`'s catch-all so it wins: Playwright tries route
 * handlers in reverse registration order.
 *
 * @param page - The page to gate. Call before `page.goto`.
 */
export async function enableAuthGate(page: Page): Promise<void> {
  const js = (body: string) => ({ status: 200, contentType: 'text/javascript', body });

  await page.route('**/src/lib/clerkAuth.ts*', (route) => route.fulfill(js(CLERK_AUTH)));
  await page.route('**/deps/@clerk_clerk-react.js*', (route) => route.fulfill(js(CLERK_REACT)));
}
