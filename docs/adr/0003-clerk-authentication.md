# ADR 0003: Clerk authentication and per-user local data

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Project owner

## Context

ADR 0001 built the dashboard as a single-user, client-only app: no accounts, and
every widget's data written to `localStorage` under a bare key (`todos`, `notes.text`,
`layout`, …). The owner now wants sign-in, so that the dashboard is not simply
"whatever this browser happens to hold".

Two things had to be settled before adding an auth provider:

- **Does auth force a backend?** ADR 0001's whole shape depends on there not being
  one. Clerk's React SDK talks to Clerk's hosted Frontend API directly from the
  browser and manages the session itself, so the answer is no — the same reasoning
  that let ADR 0002 add Google Calendar without a server.
- **What happens to data on a shared browser?** With bare keys, a second account
  signing in on the same machine would open the first account's notes, to-dos and
  reminders. Auth without data separation would be worse than no auth: it implies
  a privacy boundary that isn't there.

## Decision

1. **Clerk via `@clerk/clerk-react`,** mounted client-side. No backend, no secret
   key — only the publishable key ships to the browser. ADR 0001 still holds.
2. **Auth is opt-in, configured by `VITE_CLERK_PUBLISHABLE_KEY`** in `.env.local`,
   exactly as ADR 0002 made Google Calendar opt-in. With no key, `<ClerkProvider>`
   is never mounted, the app makes no Clerk requests, and it behaves precisely as
   it did before. `npm install && npm run dev` stays zero-setup.
3. **When a key *is* set, the whole dashboard is gated.** `<AuthGate>` renders
   Clerk's `<SignIn>` to signed-out visitors and the dashboard to signed-in ones.
   There is no signed-out read-only mode — the dashboard is entirely personal data,
   so there is nothing meaningful to show.
4. **`<SignIn routing="virtual" />`.** The app has no router; virtual routing keeps
   the whole flow inside the mounted component rather than driving URLs.
5. **Storage keys are namespaced by Clerk user id.** A `StorageScopeProvider`
   supplies the scope and `useLocalStorage` prefixes every key with it, so `todos`
   becomes `user_2abc:todos`. Signed-out (unconfigured) use keeps the bare keys.
6. **Pre-auth data is adopted by the first account to sign in.** `adoptLegacyKeys`
   moves each bare key into that user's namespace and deletes the original, so the
   owner's existing dashboard follows them into their account instead of appearing
   wiped — and a *second* account then starts empty, because the originals are gone.
7. **Sign-out and account management live in `<UserMenu>`,** a header component that
   wraps Clerk's `<UserButton>` and renders nothing when Clerk is unconfigured.

## Consequences

**Positive**

- Still a static SPA on any static host; no server, no database.
- Two people on one browser get genuinely separate dashboards.
- The feature is invisible — in behaviour *and* in network traffic — to anyone who
  does not set a key, so the existing test suite and zero-setup story are intact.
- Account switching remounts the tree, so no in-memory widget state leaks across.

**Negative / risks**

- **Data is still per-browser.** Clerk authenticates the user; it does not sync
  their data. Signing in on a second device gives an empty dashboard, because the
  widgets still read `localStorage`. This ADR does not make the dashboard portable —
  that is the cross-device sync question ADR 0001 deferred and is still open.
- **`localStorage` is not a security boundary.** Namespacing separates accounts in
  the UI, but another account's data is still readable via devtools by anyone with
  the machine. It is a privacy convenience, not encryption.
- **Signing out leaves the data on disk** under the user's namespace, by design
  (signing back in restores the dashboard) — but on a shared machine it persists.
- **The legacy-key adoption is one-way and one-time.** If the wrong account signs
  in first, the pre-auth data lands in that account's namespace; recovering it means
  renaming keys by hand in devtools.
- **A third-party dependency on Clerk's availability** when a key is configured:
  if Clerk is down, the gate never opens. The unconfigured path is unaffected.
- **Bundle cost:** the Clerk SDK is loaded only when configured, but it is a
  meaningful addition to a previously dependency-light app.

## Alternatives considered

- **Always require sign-in.** Rejected: it breaks the zero-setup property that
  ADR 0001 and 0002 both preserve, and would make the app unusable — including in
  tests — without a Clerk account.
- **Optional sign-in with the dashboard usable signed-out.** Rejected by the owner:
  it leaves ambiguous which data belongs to whom, since the signed-out dashboard
  would have to share a namespace with somebody.
- **Shared (un-namespaced) keys after sign-in.** Rejected: implies a privacy
  boundary that does not exist, as above.
- **Roll auth by hand / another provider (Auth0, Supabase).** Clerk was requested
  specifically; Supabase would also have pulled in a database and reopened ADR 0001.
- **Moving `localStorage` data into Clerk user metadata** so it syncs across
  devices. Genuinely tempting — it would fix the per-browser limitation — but user
  metadata is a small, rate-limited store not meant as an app database, and it
  would rewrite every widget's persistence. Left to the sync ADR.

## Follow-ups

- ADR 0004 (future): cross-device sync. Now that there is a stable user id, this is
  the natural next step and would resolve the biggest limitation above.
- Optionally seed the header greeting from the Clerk profile name instead of
  defaulting to "friend" when a signed-in user has not set one.
