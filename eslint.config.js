import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // The three rules below arrived in eslint-plugin-react-hooks 7.1, which
      // this project is on only because eslint 10 requires it — the 7.0 line
      // caps its peer range at eslint 9. They are React Compiler rules, and
      // each one flags a pattern that predates them and was written on purpose.
      // Turning them off keeps the dependency bump reviewable on its own;
      // reshaping the hooks is separate work that needs its own testing.
      //
      // Load-on-mount hooks that set state before their first await —
      // WeatherWidget, useCalendarSync, useSpotifyPlayer, useUpcomingEvents.
      // See the silent-reconnect comment in useCalendarSync for why.
      'react-hooks/set-state-in-effect': 'off',
      // useCalendarSync's `runOnce` reads the newest reminders through refs so
      // the polling effects can stay stable; the rule cannot see that the
      // memoization is intentional.
      'react-hooks/preserve-manual-memoization': 'off',
      // useSpotifyPlayer assigns `volumeRef.current` during render, so the
      // player callbacks read the live volume without re-subscribing.
      'react-hooks/refs': 'off',
    },
  },
])
