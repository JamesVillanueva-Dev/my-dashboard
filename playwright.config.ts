import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration. See `docs/e2e-plan.md` for what this suite is for —
 * and, just as importantly, what it deliberately leaves to the Vitest suite.
 *
 * Three things about this repo shape everything below.
 */

/**
 * The app is served under Vite's `base`, not at the root, in dev as well as in
 * production (see `vite.config.ts`). Without the path every spec would 404.
 */
const PORT = 5174;
const BASE_URL = `http://localhost:${PORT}/my-dashboard/`;

export default defineConfig({
  testDir: './e2e',
  // Rule 6: a spec that needs two attempts is broken, not slow.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  // One worker: the budget is the whole suite under 90s on a single worker, and
  // a second worker would only hide a spec that has drifted over it.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // Reduced motion (rule 4) is *not* set here. Playwright's `reducedMotion`
    // context option never reaches the browser in 1.62.1 — the page still
    // reports `no-preference` — so it is applied with `emulateMedia` by the
    // `media` fixture in `e2e/fixtures/test.ts`, which is also where a spec
    // overrides it.
  },

  projects: [
    {
      name: 'desktop',
      // Rule 3: fixed viewport, so nothing depends on the runner's window.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
      testIgnore: /\.mobile\.spec\.ts$/,
    },
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: false },
      testMatch: /\.mobile\.spec\.ts$/,
    },
  ],

  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    // A port of its own, not the 5173 a developer's own `npm run dev` holds:
    // reuse is only safe when the server being reused was started by *this*
    // config, with the environment blanked below.
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      ...process.env,
      // Clerk refuses to load in an automated browser, and with a key set
      // `AuthGate` renders the landing page instead of the dashboard — so the
      // dashboard would be unreachable. Vitest blanks these in `vite.config.ts`;
      // the dev server does not, so it is done here. Every spec therefore
      // exercises the unconfigured, signed-out app, which is what a fresh
      // visitor gets. `auth.spec.ts` puts the gate back on, from the browser.
      VITE_CLERK_PUBLISHABLE_KEY: '',
      VITE_GOOGLE_CLIENT_ID: '',
      VITE_SPOTIFY_CLIENT_ID: '',
    },
  },
});
