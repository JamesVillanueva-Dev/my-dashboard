import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Served from https://<user>.github.io/my-dashboard/, so assets need the repo
  // name as a prefix. Overridable for a different host (e.g. `BASE_PATH=/` for a
  // custom domain).
  base: process.env.BASE_PATH ?? '/my-dashboard/',
  plugins: [react()],
  // Vitest augments Vite's config with `test`. The rolldown-vite (Vite 8) and
  // Vitest-bundled Vite type definitions differ, so we assert this property
  // rather than fight the cross-version Plugin type mismatch — the runtime is fine.
  // @ts-expect-error -- `test` is a valid Vitest option at runtime.
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    restoreMocks: true,
    // Vitest loads `.env.local` like the app does, so without this the suite
    // would behave differently on a machine that has the optional integrations
    // configured — Clerk would try to mount <UserButton> with no provider, and
    // the Reminders tests would take the Calendar path. Force both off; the
    // tests that cover the configured paths mock those modules directly.
    env: {
      VITE_CLERK_PUBLISHABLE_KEY: '',
      VITE_GOOGLE_CLIENT_ID: '',
    },
  },
})
