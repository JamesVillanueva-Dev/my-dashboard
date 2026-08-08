# Manual pre-release checklist

Everything the automated suites cannot check honestly, in the order it is
quickest to walk through. This is the companion to [e2e-plan.md](e2e-plan.md):
that document's "deliberately out of scope" list is exactly what this one covers.

Nothing here is a nice-to-have that *could* be automated with more effort. Each
item needs one of: a real credential, a paid account, a permission prompt drawn
by the operating system, or a browser this project does not install. Automating
any of them would mean storing a secret in the repo or asserting against a page
someone else controls.

**Run this before a release**, against a `npm run build && npm run preview`
build rather than the dev server — a couple of these behave differently once
Vite is not in the middle.

---

## 0. Before you start

- [ ] `npm run check` passes (lint, types, 67 Vitest files).
- [ ] `npm run e2e` passes.
- [ ] `.env.local` has real values for `VITE_CLERK_PUBLISHABLE_KEY`,
      `VITE_GOOGLE_CLIENT_ID` and `VITE_SPOTIFY_CLIENT_ID`. **The e2e suite runs
      with all three blank**, so everything below this line is untested until you
      do this by hand.

> The automated suite always exercises the unconfigured, signed-out app. That is
> the right default — it is what a fresh visitor gets — but it means the
> *configured* half of the application has no automated coverage at all. That
> half is this document.

---

## 1. Clerk sign-in

Cannot be automated: Clerk refuses to load in an automated browser, and driving
its hosted form means storing a real credential.

The e2e suite reaches the landing page and the demo by stubbing the two modules
that decide whether auth is on (see `e2e/fixtures/authGate.ts`). Clerk's own code
never runs there. Everything in this section is therefore checked here or nowhere.

- [ ] Signing out and reloading lands on the landing page, not a blank screen.
- [ ] Sign in with a permitted account → the dashboard appears, furnished with
      that account's data.
- [ ] Sign in with an account that has **not** been added by hand → it is turned
      away, with a message that says so rather than a generic failure.
- [ ] **Legacy adoption.** In a browser that has never signed in: arrange a
      dashboard signed out (name, a task, a moved panel), then sign in. The
      dashboard follows you into the account; the unscoped keys are gone from
      `localStorage`.
- [ ] **Second account, same browser.** Sign out, sign in as a different
      permitted account. It starts empty — it does not inherit the first
      account's notes.
- [ ] Switching back to the first account restores that account's dashboard.

## 2. Account sync across devices (ADR 0008)

Cannot be automated: needs two real browsers signed into one real account, and
the 8KB Clerk metadata budget is only enforced by Clerk.

- [ ] Arrange a dashboard on device A, wait for the sync to settle, then open the
      account on device B. The layout, sizes, notes and tasks arrive.
- [ ] **Device split.** Rearrange the layout on a phone. Reload device A (a
      desktop): its layout is unchanged. This is the one ADR 0008 claim the e2e
      suite explicitly cannot reach — the split lives in the *account snapshot*,
      and with auth off both viewports share a single unscoped `layout` key.
- [ ] **Budget.** Paste several pages of prose into Notes. Either it syncs, or a
      visible error says it could not — it must not fail silently or truncate.
- [ ] Disconnect the network, change something, reconnect: the change is not lost.

## 3. Google Calendar and Gmail

Cannot be automated: the GIS consent popup is a Google-hosted page, and driving
it means real credentials and fighting bot detection. This mirrors
[plan.md](../plan.md)'s Phase 0 checklist.

- [ ] Connect Google Calendar. The consent popup appears, and closing it *without*
      consenting leaves the app in a sane state rather than a spinner.
- [ ] After consent, this month's events appear in the Calendar panel and in the
      Today agenda.
- [ ] Create an event from the app → it appears in Google Calendar.
- [ ] Edit it in Google Calendar → the change comes back on the next sync.
- [ ] Delete it in either place → it disappears from the other.
- [ ] A dated task becomes a real calendar event, and shows the synced badge.
- [ ] **Incremental sync.** Leave the tab open, change an event elsewhere, and
      confirm it arrives without a reload. (`gcal.syncToken` is per-browser on
      purpose — do not copy it between devices.)
- [ ] Revoke access from your Google account settings → the app reports the loss
      and offers to reconnect, rather than looping on 401s.
- [ ] Connect Gmail. The Mail panel shows three picks, and hovering one explains
      why it was chosen.
- [ ] Confirm in the network tab that **no message bodies** are requested — headers
      and Gmail's own snippet only. This is a privacy claim on the landing page.

## 4. Spotify

Cannot be automated: needs a Premium account and real audio output.

- [ ] Signed out, the embed plays 30-second previews.
- [ ] With Premium connected, a full track plays in place.
- [ ] The volume control moves actual audio, and the level survives a reload.
- [ ] Pause, skip, and previous each do what they say.
- [ ] Token expiry: leave it an hour, then press play. It reconnects rather than
      failing silently.

## 5. YouTube playback

Cannot be automated: the e2e suite stubs the IFrame API with a player that
reports no playlist, because asserting a screenshot of an embed proves it loaded,
not that it plays.

- [ ] The default playlist plays, with sound, and advances to a second track.
- [ ] Paste a video link, a playlist link, and a live stream — each loads.
- [ ] Playback position is restored when the panel is resized (which rebuilds the
      embed).
- [ ] A private playlist (`WL`, `LL…`) is reported rather than silently dead.

## 6. Notifications

Cannot be automated: the permission prompt and the resulting notice are drawn by
the operating system, outside anything the page can observe. Playwright can grant
the permission, but then there is nothing left to look at.

- [ ] Enable due reminders in Settings. The browser asks for permission.
- [ ] Grant it, add a task due in two minutes, and wait. The notice appears.
- [ ] Clicking the notice focuses the dashboard.
- [ ] Deny permission instead: the Settings row is disabled and says **Blocked**
      rather than vanishing.
- [ ] The same task does not notify twice across a reload.

## 7. Real devices

Cannot be automated: emulation is not hardware. `TOUCH_HOLD_MS` in particular is
called out in [ADR 0011](adr/0011-drag-reorder-model.md) as a guess — the e2e
suite drives real touch events through the DevTools protocol, which is closer
than a synthetic `MouseEvent` but still not a finger.

- [ ] On a phone: press and hold a panel's grip. It lifts at a moment that feels
      deliberate — not so fast that scrolling steals panels, not so slow that the
      gesture feels broken.
- [ ] Scrolling the page by starting the drag *on a grip* scrolls, and does not
      reorder.
- [ ] Drag a panel to a new position. It lands where you meant.
- [ ] Rotate to landscape: nothing sits under the notch or the home indicator.
- [ ] Pull-to-refresh at the top of the page does not fire mid-drag.
- [ ] On a tablet with both a trackpad and a touchscreen, the drag works with
      either.

## 8. Cross-browser

Cannot be automated *yet*: deferred by decision, not by difficulty. The e2e suite
is Chromium only, because this dashboard has one user on one browser. Add a
Playwright project the first time something below actually breaks.

- [ ] Safari: the grid packs correctly, the drag works, `dvh` behaves on iOS.
- [ ] Firefox: the same, plus the FLIP animation on reorder.
- [ ] Both: pick each theme and confirm the palette applies.

---

## Known defects

One is recorded as a `test.fail()` spec, so the suite stays green while the bug
stays on the record — and reports an *unexpected pass* the moment it is fixed. It
is not a regression; it is a gap found when the plan's phases were first written.

| Where | What |
| --- | --- |
| `e2e/lifecycle.spec.ts` | A stored `null` under `reminders`, `quicklinks` or `youtube.sources` — or `{}` under `user.name` — blanks the whole page. `useLocalStorage`'s `read` treats a successful `JSON.parse('null')` as a value, so the fallback never runs. Contradicts US-12. |

### Fixed

- **Panel spans were not capped to the columns on screen.** `gridMetrics` counted
  tracks from the computed `grid-template-columns`, which includes the implicit
  columns those very spans had created — so the cap read its ceiling off the
  thing it was capping. It cost ~20px of width on a phone and left panels at
  unequal widths. The count is now divided out of the grid's own width, which
  implicit 0px tracks cannot affect. `e2e/layout.mobile.spec.ts` guards it.
