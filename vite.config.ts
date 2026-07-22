import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
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
  },
})
