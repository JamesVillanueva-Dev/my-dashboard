# ADR 0002: Google Calendar integration for Reminders (client-only)

- **Status:** Accepted
- **Date:** 2026-07-22
- **Deciders:** Project owner
- **Supersedes:** the "Google integration implies a backend" assumption in ADR 0001

## Context

ADR 0001 deferred Google integration and assumed it would require a backend to
hold OAuth tokens. The owner now wants **Reminders to two-way sync with Google
Calendar**. We revisited the backend assumption: Google Identity Services (GIS)
provides an OAuth 2.0 **token flow** designed for browser SPAs, and the Calendar
REST API is CORS-enabled. So Calendar integration can be done **without a
backend**, preserving ADR 0001's no-server architecture.

Calendar events and "reminders" do not map cleanly, which drives most decisions
below:

- Calendar has **no "completed" concept** (that is Google Tasks).
- A user's primary calendar is full of events (meetings, invites) that are not
  reminders and that we should not modify.
- Reminders without a time have nothing meaningful to place on a calendar.

## Decision

1. **Client-only OAuth via GIS token flow.** No backend, no client secret. The
   access token lives only in memory (`src/lib/googleAuth.ts`); it is never
   persisted. Scope: `https://www.googleapis.com/auth/calendar` (needed to
   create the dedicated calendar and manage its events).
2. **Configuration via `VITE_GOOGLE_CLIENT_ID`** in `.env.local` (git-ignored by
   `*.local`). When unset, the widget hides all Calendar UI and behaves exactly
   as before — zero-setup still holds for everyone who doesn't opt in.
3. **A dedicated "Dashboard Reminders" calendar.** Sync only ever touches events
   on a calendar the app creates. The user's primary/other calendars are never
   read or written. This is the key decision that keeps two-way sync tractable
   and safe.
4. **Only dated reminders sync.** A reminder with a due date maps to a 30-minute
   timed event; dateless reminders stay local-only.
5. **`done` is local-only.** Completion is a local overlay and is never written
   to Calendar (Calendar can't represent it). Checking a reminder off leaves its
   event untouched.
6. **Incremental sync with last-write-wins.** We use Calendar `syncToken` for
   deltas (`src/lib/gcalSync.ts`); a `410` triggers a full resync. On conflict, a
   locally `dirty` reminder edited more recently than the remote event wins,
   else the remote event wins. Sync runs on connect, on a 60s poll, and
   (debounced) after local edits.
7. **Pure reconcile core.** `mergeRemote` and `pendingPushes` are pure functions
   taking `now` as a parameter, unit-tested in `gcalSync.test.ts`.

## Consequences

**Positive**

- Honors ADR 0001: still a static SPA, still trivially hostable, personal data
  (including the token) stays in the browser.
- The dedicated calendar means a bug can't corrupt the user's real calendar.
- Feature is fully opt-in and invisible without a client id.

**Negative / risks**

- **Setup burden on the user:** a one-time Google Cloud OAuth client is required
  (project → enable Calendar API → consent screen with self as test user →
  Web-application client id → `.env.local`). Unavoidable; Google has no key-less
  path like Open-Meteo.
- **Workspace accounts** (e.g. `@ucsd.edu`) may block third-party OAuth apps;
  a personal `@gmail.com` account is the fallback.
- **Token lifetime ~1 hour;** silent renewal works only while the Google session
  is alive, otherwise the user re-clicks Connect.
- **Sync is best-effort, not a CRDT.** Known edge cases: an edit made *during* an
  in-flight sync can be overwritten by that sync's result (the widget replaces
  the whole list); recurring events created in Google are read but not created
  by us; last-write-wins can drop a concurrent change on the losing side.
- **Publishing beyond the owner** would move the OAuth app out of "testing" and
  trigger Google's verification review for the sensitive Calendar scope.

## Alternatives considered

- **Google Tasks instead of Calendar.** Maps to reminders more naturally
  (has a completed flag), but the owner specifically asked for Calendar.
- **Sync against the primary calendar.** Rejected: noisy (every meeting becomes a
  reminder) and risky (writes into the user's real calendar).
- **`done` → delete or ✓-prefix the event.** Considered; owner chose to leave the
  event unchanged and keep completion local.
- **Add a backend for token storage / refresh tokens.** Rejected: the GIS token
  flow removes the need, and a backend would break ADR 0001.

## Follow-ups

- ADR 0003 (future): cross-device sync (would let the token/refresh story and
  per-browser `localStorage` limitation be revisited together).
- Possible tightening to the `calendar.app.created` scope so the app cannot even
  read the user's other calendars.
