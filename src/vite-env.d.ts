/// <reference types="vite/client" />

/**
 * Build-time configuration, read from `.env` by Vite and inlined into the
 * bundle. Every key is optional by design: the dashboard runs with none of them
 * set, and each one switches on a feature that is otherwise absent.
 */
interface ImportMetaEnv {
  /** Google OAuth 2.0 Web-application client ID for Calendar sync. Optional:
   *  when unset, the Reminders widget hides its Google Calendar features. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Clerk publishable key. Optional: when unset, the dashboard runs without
   *  authentication and all data is stored under unscoped localStorage keys. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  /** Spotify OAuth client ID for the in-page player (ADR 0006). Optional: when
   *  unset, the music widget stays on the anonymous embed and never offers to
   *  connect an account. No client *secret* — the flow is PKCE. */
  readonly VITE_SPOTIFY_CLIENT_ID?: string;
}

/** Narrows Vite's `import.meta.env` to the keys declared above. */
interface ImportMeta {
  /** The build's environment variables. */
  readonly env: ImportMetaEnv;
}
