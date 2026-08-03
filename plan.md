# Plan: Google Calendar + further Google integrations

## Where things stand

Google Calendar sync for Reminders is **already written** and unit-tested, per
[ADR 0002](docs/adr/0002-google-calendar-integration.md):

| Piece | File | State |
| --- | --- | --- |
| GIS token flow | [src/lib/googleAuth.ts](src/lib/googleAuth.ts) | Done — single hard-coded Calendar scope |
| Reconcile + REST | [src/lib/gcalSync.ts](src/lib/gcalSync.ts) | Done — pure `mergeRemote`/`pendingPushes`, tested |
| Sync driver | [src/hooks/useCalendarSync.ts](src/hooks/useCalendarSync.ts) | Done — connect, 60s poll, debounced push |
| Widget UI | [src/components/RemindersWidget/index.tsx](src/components/RemindersWidget/index.tsx) | Done — Connect/Disconnect/status |

What is **not** done: `VITE_GOOGLE_CLIENT_ID` is absent from `.env.local`, so none
of the above has ever run against real Google servers. Everything below assumes
Phase 0 happens first — there is no point building a second integration on an
auth layer that has not been proven once.

Guardrails that stay true for every phase: no backend (ADR 0001), no client
secret, tokens in memory only, every integration invisible until its env var is
set, and storage keys namespaced per Clerk user (ADR 0003).

---

## Phase 0 — Turn on what already exists

Goal: a real "📅 Synced" badge in the Reminders widget.

1. **Google Cloud console setup** (one-time, ~10 min)
   - Create a project (e.g. `my-dashboard`).
   - APIs & Services → Library → enable **Google Calendar API**.
   - OAuth consent screen: External, publishing status **Testing**, add your own
     Google account as a test user. Use a personal `@gmail.com` account —
     `@ucsd.edu` is a Workspace account and may block third-party OAuth apps.
   - Credentials → Create credentials → **OAuth client ID** → Web application.
     - Authorised JavaScript origins: `http://localhost:5173` (Vite dev) and the
       deployed origin if there is one.
     - No redirect URI is needed — the GIS token flow uses a popup, not a redirect.
2. **Configure locally**
   ```bash
   # .env.local  (git-ignored via *.local)
   VITE_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   ```
   Restart `npm run dev` — Vite only reads env at boot.
3. **Verify the round trip** manually, in this order:
   - Connect Calendar → consent popup → a "Dashboard Reminders" calendar appears
     in calendar.google.com.
   - Add a dated reminder → event appears remotely within a few seconds.
   - Edit the event's title in Google → it flows back within the 60s poll.
   - Delete a reminder locally → event disappears remotely.
   - Tick a reminder done → the event is deliberately **unchanged** (ADR 0002 §5).
   - Reload the page → reconnects silently, no consent popup.
4. **Fix what Phase 0 shakes out.** Two known suspects worth checking against
   real responses: `prompt: 'consent'` in `getAccessToken` forces the consent
   screen on every interactive connect (should only be needed for the first
   grant), and a token that expires mid-session should renew silently rather
   than surfacing an error in the widget.
5. Add a `.env.example` listing both `VITE_GOOGLE_CLIENT_ID` and
   `VITE_CLERK_PUBLISHABLE_KEY` with placeholder values, so setup is discoverable.

**Done when:** the six manual checks above pass and `npm run lint`, `npx tsc -b`,
`npm run test:run` are green.

---

## Phase 1 — Generalise the auth layer (the enabling refactor)

`googleAuth.ts` today caches exactly one token and hard-codes `CALENDAR_SCOPE`
into `initTokenClient`, ignoring what callers ask for. Every integration after
this one needs a different scope, so this must be reshaped before Phase 2+.
Do it as its own change, with Calendar still the only consumer, so a regression
here is unambiguous.

Target shape for `src/lib/googleAuth.ts`:

```ts
export const SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar',
  tasks:    'https://www.googleapis.com/auth/tasks',
  gmail:    'https://www.googleapis.com/auth/gmail.readonly',
  drive:    'https://www.googleapis.com/auth/drive.metadata.readonly',
} as const;

/** Resolves a token for one scope, reusing a cached one when still valid. */
export function getAccessToken(scope: string, interactive: boolean): Promise<string>;
/** Which scopes the user has granted this session (drives per-widget UI). */
export function grantedScopes(): string[];
export function clearAccessToken(scope?: string): void; // omit scope = clear all
```

Steps:

1. Replace the module-level `accessToken`/`tokenExpiry`/`tokenClient` singletons
   with a `Map<scope, { token, expiry, client }>`; keep the one-in-flight-request
   guard per scope.
2. Pass `include_granted_scopes: true` so a second consent adds to the first
   grant instead of replacing it, and use `google.accounts.oauth2.hasGrantedAllScopes`
   to decide whether a request can be silent.
3. Extract the shared `fetch` wrapper (auth header, JSON, status→`ApiError`)
   out of `gcalSync.ts` into `src/lib/googleApi.ts` — Tasks/Gmail/Drive all need
   the identical wrapper, plus one shared place to handle `401` (token expired →
   retry once) and `403 rateLimitExceeded` (back off).
4. Update `gcalSync.ts` to call `getAccessToken(SCOPES.calendar, …)` and the
   shared wrapper. No behaviour change.
5. Add `src/lib/googleAuth.test.ts` covering: cached token reuse, per-scope
   isolation, expiry-minus-60s refresh, and rejection when unconfigured.

**Done when:** Phase 0's manual checks still pass unchanged, plus green checks.

---

## Phase 2 — Calendar *viewing* widget (new)

Reminders sync writes to a dedicated calendar and never reads the user's real
one. A dashboard wants the opposite: "what's on today?" That is a separate,
read-only widget, not an extension of Reminders.

1. Scaffold with `npm run create:component` → `src/components/CalendarWidget/`
   (`index.tsx`, `index.test.tsx`, `styles.module.css` — folder-as-component).
2. New `src/hooks/useUpcomingEvents.ts`: reads `/users/me/calendarList` and
   `events?timeMin=now&timeMax=+7d&singleEvents=true&orderBy=startTime`, merged
   across selected calendars, refreshed on a poll and on tab focus.
3. Read-only scope: `calendar.readonly` covers this, but the app will already
   hold the broader `calendar` scope from Phase 0 — request the narrow one only
   if the user has not connected Reminders sync, so a viewer-only user is not
   asked for write access.
4. UI: agenda list grouped by day, "Today / Tomorrow / Thu 14", all-day events
   pinned first, current-time marker, empty state, and a "Connect Google" button
   mirroring Reminders when no token is held. Root element takes `styles.container`
   via `<Widget title="Calendar" className={styles.container}>`.
5. Register in [src/lib/registry.tsx](src/lib/registry.tsx):
   `{ id: 'calendar', title: 'Calendar', icon: '📅', render: () => <CalendarWidget /> }`.
   New ids append to the catalogue; existing saved layouts pick it up as
   "available to add", so no migration is needed.
6. Tests: mock `fetch`, assert grouping/ordering, the unconfigured path renders
   the hint and makes **no** network calls, and error states render.

### Phase 2b — month view (done, pending Phase 0 verification)

The agenda answers "what's next?"; it does not answer "what does my month look
like?". That is a second surface, opened from the widget's header rather than
crammed into a dashboard card:

| Piece | File | Notes |
| --- | --- | --- |
| Range fetch | [src/lib/gcalEvents.ts](src/lib/gcalEvents.ts) | `fetchRange(interactive, timeMin, timeMax)`; `fetchUpcoming` is now a wrapper over it. Follows `nextPageToken` (capped at 5 pages) — a month across several calendars overruns one page, which would have silently dropped the tail of the month. Events carry `calendarTitle`/`calendarColor`. |
| Grid maths | [src/lib/calendarGrid.ts](src/lib/calendarGrid.ts) | Pure, clock-free: fixed 6×7 grid, fetch window covering the borrowed days at each end, and day bucketing that repeats multi-day events. |
| Data driver | [src/hooks/useMonthEvents.ts](src/hooks/useMonthEvents.ts) | Per-month cache, request-sequence guard against out-of-order responses. Read-only and silent — it never starts a consent flow and owns no storage key. |
| UI | [src/components/CalendarModal/index.tsx](src/components/CalendarModal/index.tsx) | Month grid + day detail panel, portalled over the dashboard. Focus trap, focus restore, roving-tabindex arrow navigation. |

Two things worth remembering, both tested in
[src/lib/calendarGrid.test.ts](src/lib/calendarGrid.test.ts):

- Google's all-day `end.date` is **exclusive** (3–5 Aug arrives as end `08-06`),
  and a timed event ending at exactly midnight belongs to the previous day.
  Backing the end off by 1ms resolves both with one rule.
- Days are stepped through `Date`'s calendar fields, never by adding
  86,400,000ms — the latter lands on the wrong day across a DST boundary.

Still open: the month view holds its cache only while the dialog is mounted, and
`WEEK_STARTS_ON` is a constant rather than a setting.

### Phase 2c — editing (done, pending Phase 0 verification)

The month view now creates, edits and deletes events on the user's **real**
calendars, per [ADR 0004](docs/adr/0004-calendar-writes-to-user-calendars.md).
This reverses ADR 0002's containment rule deliberately; read that ADR before
changing anything here.

| Piece | File | Notes |
| --- | --- | --- |
| Writes | [src/lib/gcalWrite.ts](src/lib/gcalWrite.ts) | The only module that mutates real calendars. Pure mapping (`blankDraft`, `draftFromEvent`, `validateDraft`, `toResource`, `needsMove`) plus create/update/delete. Changing an event's calendar moves it first — patching the organiser does nothing. |
| Flow | [src/hooks/useEventEditor.ts](src/hooks/useEventEditor.ts) | Owns new/edit/delete state. A failed write keeps the form open holding the user's input. |
| Form | [src/components/EventForm/index.tsx](src/components/EventForm/index.tsx) | Replaces the day detail panel. Delete takes two clicks. |

What keeps this safe, now that the sandbox is gone: writes live in one module,
happen only from the form's Save/Delete, always name their target calendar, and
are never offered for calendars the user cannot write to.

---

## Phase 3 — Google Tasks ↔ To-do widget

Tasks is the natural home for the "done" flag that ADR 0002 had to keep local,
so this closes a real gap rather than duplicating Calendar.

1. Enable **Google Tasks API** in the same Cloud project; scope
   `https://www.googleapis.com/auth/tasks`.
2. `src/lib/gtasksSync.ts`, deliberately mirroring `gcalSync.ts`'s shape: pure
   `mergeRemote`/`pendingPushes` taking `now`, orchestrated by `runSync`.
   Differences to design for:
   - Tasks has **no `syncToken`**. Use `updatedMin` + `showDeleted=true` +
     `showHidden=true` for incremental pulls, and persist the last poll time.
   - `status: 'needsAction' | 'completed'` maps directly to `todo.done`, so
     completion syncs both ways here (unlike Calendar).
   - Use a dedicated task list ("Dashboard To-dos") created by the app, same
     containment argument as the dedicated calendar.
3. `src/hooks/useTasksSync.ts` modelled on `useCalendarSync` — if the two end up
   near-identical, factor the connect/poll/debounce shell into a shared
   `useGoogleSync` and keep only the reconcile logic separate.
4. Extend `TodoWidget` with the same Connect/Synced/Disconnect affordance.
5. Port the `gcalSync.test.ts` test cases to `gtasksSync.test.ts` (adds/edits/
   deletes/conflicts/tombstones) — the reconcile core is where bugs hide.

---

## Phase 4 — Gmail unread widget (read-only, optional)

1. Enable **Gmail API**; scope `gmail.readonly`.
   ⚠️ This is a **restricted** scope: fine while the OAuth app is in Testing with
   you as the only test user, but publishing would trigger Google's verification
   *and* a CASA security assessment. If this dashboard is ever going public,
   drop this phase or keep it behind its own env flag.
2. `src/components/GmailWidget/` — count + subject/sender for the newest N of
   `users/me/messages?q=is:unread in:inbox`, then `messages/{id}?format=metadata`
   per message (batch the metadata fetches; the list endpoint returns ids only).
3. Strictly read-only: link out to `mail.google.com` rather than adding
   archive/reply actions, which would need a write scope and error-handling depth
   this dashboard should not carry.
4. Poll at a slower cadence than Calendar (5 min) and only while the tab is
   visible — Gmail's per-user quota is easy to burn with a 60s poll.

## Phase 5 — Google Drive recents (optional, lowest value)

Same pattern: `drive.metadata.readonly`, `files?orderBy=viewedByMeTime desc`,
a link list widget. Build only if Phases 2–4 land cleanly; it is the least
useful of the four on a start page.

---

## Cross-cutting work

- **One connection surface.** By Phase 3 there are three per-widget "Connect"
  buttons requesting three scopes. Add a **Google** section to the header /
  `UserMenu` showing connected products with per-product connect/disconnect,
  and reduce the widget buttons to a status badge. Incremental authorisation
  (Phase 1 §2) is what makes this coherent — the user grants Calendar now and
  Tasks later without re-consenting to everything.
- ~~**Scope tightening.** ADR 0002's own follow-up: move Reminders sync to
  `calendar.app.created`.~~ **Withdrawn** by
  [ADR 0004](docs/adr/0004-calendar-writes-to-user-calendars.md) — Phase 2c
  writes to the user's own calendars, which needs the full `calendar` scope.
  Reminders sync could still be narrowed on its own, but the app as a whole can
  no longer claim it cannot reach real calendars.
- **Failure UX.** One shared pattern for expired token / revoked access /
  offline / quota exceeded, rather than each widget inventing its own string.
  Revoked access should reset `wantConnected` so the app stops retrying silently.
- **Docs.** ADR 0004 for the multi-product Google story (scope strategy,
  incremental auth, per-product opt-in, Gmail's restricted-scope risk). Update
  `README.md` setup and the source-tree map, and `docs/user-stories.md` for the
  new widgets.
- **Checks.** `npm run lint`, `npx tsc -b`, `npm run test:run` green at the end
  of every phase — not just at the end of the plan.

## Decisions to make before starting

1. **Is this dashboard ever going public?** If yes, Phase 4 (Gmail) is probably
   out — and note that Phase 2c has already made `calendar.app.created`
   impossible, so a write-capable Calendar scope is what Google's verification
   review would be looking at.
2. **Tasks vs. Reminders overlap.** Once Phase 3 exists, Reminders (Calendar,
   dateless items local) and To-dos (Tasks, completion syncs) are similar enough
   that keeping both may confuse. Decide whether they stay separate widgets or
   merge.
3. **Phase ordering.** Phases 2–5 are independent after Phase 1; Phase 2
   (Calendar viewing) is the highest value per unit of work and the recommended
   next step after 0 and 1.
