/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth 2.0 Web-application client ID for Calendar sync. Optional:
   *  when unset, the Reminders widget hides its Google Calendar features. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
