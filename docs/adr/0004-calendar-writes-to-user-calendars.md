# ADR 0004: Creating and editing events on the user's own calendars

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Project owner
- **Amends:** [ADR 0002](0002-google-calendar-integration.md) decision 3 and its
  `calendar.app.created` follow-up

## Context

ADR 0002's third decision — "sync only ever touches events on a calendar the app
creates; the user's primary/other calendars are never read or written" — was the
safety argument that made two-way sync tractable. Its explicit follow-up was to
tighten the scope to `calendar.app.created` so the app *could not* reach the
user's real calendars at all.

Two later changes ate that boundary from both ends:

1. The **Calendar viewing widget** (plan Phase 2) reads every calendar the user
   has selected. Reading was already outside the sandbox.
2. The owner now wants to **add, edit and delete events from the dashboard, the
   way Google Calendar does**, filing them on a chosen real calendar.

There is no version of "add an event as if I were using Google Calendar" that
lives inside an app-created sandbox: an event the user cannot see next to their
meetings, on a calendar they did not choose, is not the feature. So the question
is not whether to keep the sandbox — it is what replaces it as the safety story.

## Decision

1. **The app writes to the user's own calendars.** ADR 0002 decision 3 no longer
   holds for the month view. The Reminders sync path (`gcalSync.ts`) is
   unchanged and still confines itself to "Dashboard Reminders".
2. **Writes live in their own module,** `src/lib/gcalWrite.ts`. `gcalEvents.ts`
   stays strictly read-only, so the polling and rendering path has no way to
   mutate anything.
3. **Every write is a direct user action.** Nothing polls, retries, or writes in
   the background. The only callers are the event form's Save and Delete.
4. **The target calendar is always explicit.** It comes from a picker listing
   only calendars with `accessRole` owner or writer, defaulting to primary. It is
   never inferred, and read-only calendars are never offered — their events show
   no Edit control at all.
5. **Deleting takes two clicks.** There is no undo against a real calendar, which
   is more than a single misplaced click should cost. Editing does not: it is
   recoverable, and Google keeps its own history.
6. **Recurrence is not modelled.** Everything is read with `singleEvents=true`,
   so an edit or delete hits one occurrence. The form says so out loud rather
   than pretending to offer "this and following".
7. **The `calendar.app.created` follow-up is withdrawn.** The scope stays
   `https://www.googleapis.com/auth/calendar`, which this feature requires.
8. **Pure mapping core.** `blankDraft`, `draftFromEvent`, `validateDraft`,
   `toResource` and `needsMove` are pure functions, unit-tested in
   `gcalWrite.test.ts`, including round-tripping Google's exclusive all-day
   `end.date`.

## Consequences

**Positive**

- The dashboard is a real calendar client, not a read-only window onto one.
- The blast radius is bounded by construction: one module, user-initiated only,
  explicit target, no write path reachable from rendering or polling.

**Negative / risks**

- **A bug here can damage real calendar data.** This is the cost of the feature
  and the reason for decisions 2–5. ADR 0002's strongest safety property is gone.
- **The scope can no longer be tightened.** Any future "this app can only see its
  own calendar" reassurance is off the table while this feature exists.
- **Publishing gets harder,** not easier: a write-capable Calendar scope is
  exactly what Google's verification review scrutinises.
- **No optimistic UI.** A save waits for the round trip, then re-reads the month.
  Simple and always consistent, but slower than Google Calendar feels.
- **Concurrent edits are last-write-wins,** with no ETag/`If-Match` check: an
  event changed elsewhere between load and save is overwritten silently.

## Alternatives considered

- **Keep writes in "Dashboard Reminders".** Preserves ADR 0002 intact, but files
  new events somewhere the user did not choose and would not look — rejected by
  the owner as not the requested feature.
- **Always write to primary, no picker.** Simpler UI and a smaller surface, but
  anyone keeping work and personal calendars separate would have to fix every
  event afterwards in Google Calendar.
- **Create only, no edit or delete.** Meaningfully safer — nothing existing can
  be damaged. Rejected by the owner, who asked for the full behaviour.
- **Optimistic updates with rollback.** Better perceived speed; rejected for now
  because a failed rollback leaves the grid lying about the user's calendar.

## Follow-ups

- Send `If-Match` with the event's ETag so a concurrent edit fails loudly instead
  of silently overwriting.
- Offer "this and following occurrences" for recurring events, which needs the
  series (`recurringEventId`) fetched separately and a `RRULE` edit.
- Drag-to-move events between days in the grid, which is the next thing that
  will feel missing.
