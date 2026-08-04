# ADR 0008: Dashboard state follows the account, with layout kept per device

- **Status:** Accepted
- **Date:** 2026-08-04
- **Deciders:** Project owner

## Context

ADR 0003 namespaced every `localStorage` key by the signed-in user's id, so two
accounts sharing a browser cannot see each other's data. That solved separation
and left the harder half untouched: the data is still *in the browser*. Sign in
on a second device and the dashboard is empty. Use a browser that clears site
data on exit — the default for anyone with strict privacy settings — and it is
empty every morning.

That is the failure the owner actually hit: sources added to the YouTube panel
were gone at the next launch, and re-adding them each session is not a dashboard,
it is a chore. Signing in already implies an account; the reasonable expectation
is that signing in is what *restores* your dashboard.

The obvious answer is a backend, which ADR 0001 exists to avoid. But Clerk is
already here, already called directly from the browser, and already storing
things about the user. Its `unsafeMetadata` is a small JSON blob that the account
owner's own browser may write. That is a store bound to the account rather than
the device, reachable without a server of ours.

## Decision

**Mirror the user-authored subset of `localStorage` into Clerk's
`unsafeMetadata`, pulling on sign-in and pushing on change.**

0. **Layout is per form factor; content is shared.** A three-column desktop
   arrangement is not a phone layout, and syncing them as one value means each
   device overwrites the other on every visit. So the snapshot splits: a shared
   core, plus a slice per form factor holding `DEVICE_KEYS` — panel order, widget
   sizes, and the daily-focus toggle. Everything a user *authored* — notes,
   tasks, links, saved sources — stays shared, because a note written on a phone
   that did not exist on the PC would be a bug, not a feature.

   Only layout is duplicated, which matters against the 8KB cap below: an id list
   and a small map cost little, whereas duplicating content would nearly halve
   the room available for it.

   The form factor is `pointer: coarse`, the query the touch styles already use.
   It describes the *device*, so narrowing a desktop window cannot flip you into
   the phone's layout and start saving over it — which a width breakpoint would.

   A push republishes every other form factor's slice verbatim. The account holds
   one metadata blob, so a phone that saved only its own arrangement would delete
   the PC's.

1. **An allowlist, not "everything".** `SHARED_KEYS` and `DEVICE_KEYS` name what
   travels. Two exclusions carry real weight:
   - **`cache:*`** — cached weather and headlines. Public, refetchable, and
     individually large enough to exhaust the metadata budget.
   - **`gcal.syncToken`** — Google's incremental-sync cursor. It records what
     *this replica* has already consumed. Copied to a second device, that device
     resumes from a position it never reached and silently skips every event in
     between. Sync cursors are per-replica by definition.

   Spotify's OAuth token is absent for the reason it lives in `sessionStorage`
   (ADR 0006): credentials do not belong in synced storage.

2. **Pull during render; push in the background.** The pull runs in a
   `useState` initializer inside `AuthGate`'s `Scope`, alongside the
   `adoptLegacyKeys` call that already worked this way. That is not a
   micro-optimisation: `useLocalStorage` persists on mount, so widgets rendered
   against an un-hydrated namespace would write their defaults and the account's
   real data would arrive to find itself already overwritten. Ordering matters
   twice over — `adoptLegacyKeys` must run *before* the snapshot is collected, or
   a pre-auth dashboard reads as empty and loses.

   The push is the mirror image. It changes nothing locally, so holding the UI
   behind a spinner for it would be a blank screen bought for no guarantee; it
   runs behind a mounted dashboard. Reaching for a loading gate to cover both
   directions was the first design here, and it was wrong in the cheap direction:
   it paid a spinner for something render-time hydration already guaranteed.

3. **Last-write-wins on a local stamp.** Each browser records when its synced
   data last changed; the higher stamp wins the whole snapshot. A browser that
   has never recorded a change compares as `0`, i.e. older than any account copy
   — so a fresh device pulls rather than pushing its emptiness. Dating an
   unstamped browser to "now" instead would make every new device outrank the
   real dashboard, which is precisely the data-loss this feature exists to
   prevent. Merging two divergent dashboards field by field would need a per-key
   change history this deliberately does not keep, and would still have to guess
   which of two edited note bodies the user meant.

   The stamp only moves when the data actually differs from what the account
   holds. Every widget writes its current value on mount, and counting that as an
   edit would bump the stamp on every page load — so merely opening the dashboard
   on a spare laptop would outrank a phone with genuinely newer changes.

4. **Over budget fails loudly.** Clerk caps metadata at 8KB. An oversized
   snapshot is *refused* and reported in the UI, naming the largest key, rather
   than truncated. Silently dropping a user's notes to satisfy a quota nobody
   told them about is the worst available outcome.

5. **Off unless Clerk is.** With no publishable key there is no user, sync
   reports `off`, and the dashboard behaves exactly as it always has. The
   zero-setup path is untouched.

## Consequences

**Positive**

- Signing in on any device or browser restores the dashboard. This is what
  users assume signing in already did.
- A phone and a PC each keep the arrangement that suits their screen, while
  still sharing one set of notes, tasks and saved sources.
- Survives a browser that clears site data on exit, which `localStorage` alone
  never could.
- No backend, so ADR 0001 still holds.

**Negative**

- **8KB is not much.** Preferences, layout, links and sources fit comfortably;
  a long Notes panel will not. The cap is Clerk's, and the honest response is
  the visible error rather than a silent one — but it does mean the Notes widget
  can outgrow sync while the rest of the dashboard keeps working.
- **Last-write-wins loses edits.** Two devices changed while offline, and the
  older one's changes are gone. Because a push republishes the other slice from
  whatever remote copy it last saw, a losing device can also have its *layout*
  reverted, not just its content. Documented, not solved.
- **Only two form factors.** A tablet is whatever `pointer: coarse` says it is,
  which lumps it in with phones. Splitting further would multiply layouts against
  a fixed byte budget for a distinction few users would notice.
- **The pull reads metadata Clerk already delivered**, so it costs no round trip
  — but it is therefore only as fresh as Clerk's session. A device that has been
  open for hours pulls what it was handed at sign-in.
- **`unsafeMetadata` is user-writable by design.** Fine for preferences,
  disqualifying for anything trusted — nothing in `SYNCED_KEYS` may ever become
  an authorization input.

## Alternatives considered

- **A real backend.** The straightforward answer, and the one ADR 0001 rules
  out. Would solve the size cap and enable real merging; costs the entire
  "nothing to deploy" property.
- **Google Drive `appDataFolder`.** Effectively unlimited and already adjacent
  to the Google OAuth in ADR 0002. Rejected because it would tie dashboard sync
  to *Calendar* being configured, making the feature arrive for reasons the user
  cannot predict.
- **Sync only the small things and leave Notes local.** Tempting, and it dodges
  the cap — but a dashboard that syncs some panels and not others is harder to
  explain than one that syncs everything and says so when it cannot.
