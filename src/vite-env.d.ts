/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth 2.0 Web-application client ID for Calendar sync. Optional:
   *  when unset, the Reminders widget hides its Google Calendar features. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Clerk publishable key. Optional: when unset, the dashboard runs without
   *  authentication and all data is stored under unscoped localStorage keys. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
