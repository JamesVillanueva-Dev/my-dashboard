# Plan: end-to-end tests

> **Status: built.** All six phases are in `e2e/`, run with `npm run e2e`
> (47 specs, ~60s, one worker). The manual checklist Phase 6 called for is
> [e2e-manual.md](e2e-manual.md). The four open decisions at the foot of this
> document were settled as: e2e does **not** gate `npm run check`; all phases
> were built, not just 1–2; specs live in `e2e/` with their own
> `tsconfig.e2e.json` and eslint block; and the ADR 0011 measurements are now
> regenerable from `drag.spec.ts` rather than from a lost script.
>
> Two things the plan assumed turned out not to hold, and the sections below
> still describe the assumption rather than what was built:
>
> - **Demo mode is not reachable with auth off**, so Phase 4's demo round trip
>   needed the gate switched back on from the browser — see
>   `e2e/fixtures/authGate.ts`.
> - **ADR 0008's device split is account-synced state**, not `localStorage`, so
>   the mobile spec covers the media query and leaves the split to the manual
>   checklist.
>
> The suite also found two defects, both recorded as `test.fail()` specs; they
> are listed at the foot of [e2e-manual.md](e2e-manual.md).

## Where things stand

There are **no end-to-end tests**. The suite is 67 Vitest files / ~1250 tests,
all in jsdom ([vite.config.ts](../vite.config.ts) sets `environment: 'jsdom'`),
covering pure logic in `src/lib`, hooks in `src/hooks`, and components rendered
with Testing Library. Playwright has been used here twice as a throwaway
measurement script — [ADR 0011](adr/0011-drag-reorder-model.md)'s validation
table was produced that way — but nothing was committed, and there is no
Playwright dependency, config, or spec in the repo.

The component tests already reach quite far: [Dashboard/index.test.tsx](../src/components/Dashboard/index.test.tsx)
mounts the whole app and drives the widget menu, keyboard reorder, and keyboard
resize. What it cannot do is anything that needs a browser to actually lay the
page out.

---

## Why bother — the gaps jsdom cannot close

Each row is a real behaviour with no honest coverage today, and the reason the
existing tests cannot supply it.

| Behaviour | Why jsdom cannot test it | Where the workaround shows |
| --- | --- | --- |
| Drag-to-reorder feel | No layout: every rect is 0×0, so `resolveTarget` has no geometry to resolve against | The model is unit tested against a **hand-written** `PanelRect[]` in [dragOrder.test.ts](../src/lib/dragOrder.test.ts); the real rects are never measured |
| Pointer gestures | jsdom implements no `PointerEvent` | [Dashboard/index.test.tsx](../src/components/Dashboard/index.test.tsx) builds a `MouseEvent` and bolts `pointerId`/`pointerType` onto it |
| FLIP animation on reorder | No `DOMMatrixReadOnly`, no transitions | `layoutRect`'s transform correction only runs against the `FakeMatrix` stub in [gridGeometry.test.ts](../src/lib/gridGeometry.test.ts) |
| Grid row spans / panel heights | `offsetHeight` is 0 and `getComputedStyle` reports no grid tracks | `applySpan` is tested with a hand-set `offsetHeight`; `gridMetrics` falls back to its built-in 8px/12px constants |
| Resize by dragging the corner | Needs real pointer + real column widths | Only the **keyboard** resize path is covered; the drag path is untested end to end |
| CSS custom properties per theme | jsdom does not apply stylesheet cascade | Tests assert `data-theme` is set, never that the palette actually changed |
| Scroll lock / focus trap in modals | Partly works, but `document.body.style.overflow` in jsdom proves nothing about a real scrollbar | [WidgetModal](../src/components/WidgetModal/index.test.tsx) asserts the style property, not the effect |
| Reload persistence | No navigation; unmount+remount stands in for it | Several suites say "the same thing a page reload does" — an assumption, not a check |
| Mobile vs desktop layout split | `matchMedia` is stubbed per test | [ADR 0008](adr/0008-account-synced-dashboard-state.md)'s device-key split is verified against a fake `matchMedia`, never a real viewport |
| Offline / slow network | `fetch` is stubbed | Loading and error states are proven; the transitions between them under real timing are not |

The two worth the most: **drag/resize geometry** and **reload persistence**.
Everything else on that list is a bonus.

---

## What e2e is explicitly *not* for

A guardrail, because the cheapest way to ruin this is to re-test 1250 unit tests
through a browser at 100× the cost.

- **No logic assertions.** Ranking, merging, sorting, parsing, validation belong
  in `src/lib` tests and stay there.
- **No per-widget CRUD sweeps.** "Add a task, tick it, delete it" is covered by
  [RemindersWidget](../src/components/RemindersWidget/index.test.tsx). One e2e
  path through one widget proves the wiring; the rest is duplication.
- **No error-copy assertions.** Which string appears on a 403 is a component
  test's job.
- **Target: under 30 specs total.** If it grows past that, something belongs in
  the unit suite instead.

---

## Tooling

**Playwright**, Chromium only to start.

- Already proven against this app (ADR 0011), and per
  [docs/drag-polish-prompt.md](drag-polish-prompt.md#L250) chromium is installed
  on the dev machine.
- `page.mouse` produces real trusted pointer events — the specific thing the
  drag path needs.
- `page.route` for network stubbing, `page.clock` for pinning time,
  `addInitScript` for seeding storage before the app boots. All three are needed
  here (see below).
- Firefox/WebKit are deferred: this dashboard has one user on one browser. Add
  them only if a cross-browser bug is ever actually observed.

New dev dependency: `@playwright/test`. That is the first runtime-adjacent
dependency added in a while — worth noting given ADR 0001's "no dependencies"
instinct, but it is dev-only and never ships.

---

## Three problems this repo poses

These are the things that will eat a day if they are not planned for.

### 1. The base path

[vite.config.ts](../vite.config.ts#L9) sets `base: '/my-dashboard/'` for GitHub
Pages, and Vite honours `base` in dev too. The app is served at
**`http://localhost:5173/my-dashboard/`**, not the root. Playwright's `baseURL`
must include the path, or every spec 404s.

```ts
use: { baseURL: 'http://localhost:5173/my-dashboard/' },
webServer: {
  command: 'npm run dev',
  url: 'http://localhost:5173/my-dashboard/',
  reuseExistingServer: !process.env.CI,
},
```

### 2. Clerk blocks headless browsing

If `VITE_CLERK_PUBLISHABLE_KEY` is set in `.env.local`, `AuthGate` renders the
landing page and the dashboard is unreachable to an automated browser — Clerk
refuses to load. The Vitest config already forces the three integration env vars
empty ([vite.config.ts:25-29](../vite.config.ts#L25-L29)); **the dev server does
not**, so the e2e `webServer` must blank them itself:

```ts
webServer: {
  command: 'npm run dev',
  env: {
    VITE_CLERK_PUBLISHABLE_KEY: '',
    VITE_GOOGLE_CLIENT_ID: '',
    VITE_SPOTIFY_CLIENT_ID: '',
  },
}
```

This means e2e always exercises the **unconfigured, signed-out** app — which is
the state that matters, since that is what a fresh visitor gets. Testing the
configured paths is out of scope (see below).

### 3. Everything is localStorage, and it is read at boot

Every panel reads its state on first render, so a spec that navigates and *then*
seeds storage tests the empty state. Seeding has to happen in an init script:

```ts
await page.addInitScript((state) => {
  for (const [key, value] of Object.entries(state)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}, { layout: ['reminders', 'weather', 'notes'], reminders: [...] });
```

The keys the app owns, for the fixture:

`layout` · `widget.sizes` · `today.showFocus` · `focus` · `theme` ·
`aura.follow` · `user.name` · `greeting` · `notes.text` · `reminders` ·
`tasks.mergedTodos` · `quicklinks` · `news.feed` · `news.sources` ·
`weather.unit` · `weather.place` · `youtube.sources` · `youtube.current` ·
`spotify.sources` · `spotify.current` · `spotify.volume` · `classes.courses` ·
`classes.current` · `notify.tasks` · `notify.sent` · `mail.connected` ·
`mail.dismissed` · `gcal.connected` · `gcal.view.connected` ·
`gcal.calendarId` · `gcal.syncToken`

Signed-in state namespaces these behind `<clerk-user-id>:`; demo mode uses
`demo:`. Neither is reachable with auth switched off, so the fixture only needs
the unscoped forms.

---

## Fixtures to build first

Four helpers, in `e2e/fixtures/`. Everything else is a spec.

| Fixture | Job |
| --- | --- |
| `seed(page, state)` | `addInitScript` writing the storage keys above, JSON-encoded as `useLocalStorage` expects |
| `stubNetwork(page)` | `page.route('**/*', …)` answering Open-Meteo, allorigins/RSS, and the favicon service with canned payloads; **fails the test on any unrouted external request**, so a spec can never silently hit the real internet |
| `pinClock(page, iso)` | `page.clock.setFixedTime` — `TodayPanel` counts what falls on *today*, so a floating clock makes specs fail near midnight (the same trap [TodayPanel/index.test.tsx](../src/components/TodayPanel/index.test.tsx#L74-L81) already documents) |
| `panel(page, id)` | Locator helper for a grid item by `data-id`, plus its drag grip, resize handle, and measured box |

The unrouted-request failure in `stubNetwork` is the important one. Without it a
spec passes on a machine with network and hangs on one without.

---

## Phases

Each phase ends green on `npm run lint`, `npx tsc -b`, `npm run test:run`, and
the e2e suite — same rule the Google plan uses.

### Phase 1 — Harness, one smoke spec

Goal: `npm run e2e` boots the app and asserts it rendered.

1. `@playwright/test` + `playwright.config.ts` with the baseURL, `webServer`,
   and blanked env from above.
2. The four fixtures.
3. `e2e/smoke.spec.ts` — loads `/`, asserts the default widgets are present and
   **no console errors or unhandled rejections** were emitted. That last check
   is worth having on its own; nothing in the unit suite catches a boot-time
   console error.
4. Scripts: `"e2e": "playwright test"`, `"e2e:ui": "playwright test --ui"`.
   Leave `npm run check` alone for now — e2e is slower and needs a browser, so
   it should not gate every local commit until it has proven stable.

### Phase 2 — The geometry gap (the reason for all this)

Goal: cover what [ADR 0011](adr/0011-drag-reorder-model.md) measured by hand.

- **A deliberate drag reorders the grid.** Grab panel 1's grip, sweep past panel
  2's midpoint, release; assert the DOM order changed *and* survives a reload.
- **Jitter does not thrash.** Oscillate ±3px across a boundary 20 times; assert
  **exactly one** reorder. This is ADR 0011's headline number and currently only
  exists as a unit test over synthetic rects.
- **A held pointer reorders nothing.** 1s still, zero reorders.
- **`pointercancel` leaves nothing stuck** — no residual `transform`, and the
  next pointer move does nothing.
- **Corner-drag resize** changes the column span, and the panel's rendered width
  actually changes with it. The keyboard path is covered; this one is not.
- **Row span covers the content.** After a resize, assert the card's rendered
  height fits inside its grid area — the `applySpan` arithmetic against real
  layout rather than a stubbed `offsetHeight`.
- **Touch drag.** `TOUCH_HOLD_MS` is called out in ADR 0011 as "a guess that has
  not been tried on real hardware"; Playwright's touch emulation is not real
  hardware either, but it is closer than nothing.

### Phase 3 — Things a real browser decides

- **Theme actually repaints.** Pick Forest; assert the computed value of `--bg`
  on `:root` changed, not just the `data-theme` attribute.
- **Favicon href changes** with the theme (the unit test asserts the link's
  `href`; this asserts it after a real style recalc).
- **Full-screen panel**: opens as a portal, the page behind genuinely cannot
  scroll, Tab wraps inside, Escape closes, focus returns to the opener.
- **Mobile viewport** at 390×844 gets the single-column layout, and the layout
  it saves does not overwrite the desktop one ([ADR 0008](adr/0008-account-synced-dashboard-state.md)'s
  device split, verified against a real media query for once).

### Phase 4 — Lifecycle across reloads

- **Furnish and reload.** Rename the greeting, set a focus, add a task, reorder
  a panel, resize it, switch theme → reload → every one of those survived. One
  spec, high value: it is the whole "local-first" promise (US-11) in a single
  path, and no unit test can navigate.
- **Demo mode round trip.** Landing page → Try the demo → dashboard is furnished
  with sample data → Exit demo → landing page, and **nothing `demo:`-prefixed is
  left in storage**.
- **Corrupt storage degrades.** Seed `layout` and `reminders` with junk; the app
  still boots to a usable dashboard (US-12).

### Phase 5 — Network states, stubbed

One representative panel each, not all of them.

- **Weather**: pending → loaded, then a routed 500 → error + Retry → Retry
  succeeds.
- **News**: cached copy paints with no loading flash on a second visit.
- **Fully offline** (`context.setOffline(true)`): the dashboard still renders,
  every network panel shows its own error, and nothing takes the page down.

### Phase 6 — Not automated: a manual checklist

Write `docs/e2e-manual.md` covering what cannot be automated honestly (below),
so the configured paths at least have a repeatable script a human can run before
a release.

---

## Deliberately out of scope

- **Real Google OAuth.** The GIS consent popup is a Google-hosted page; driving
  it means storing real credentials and fighting bot detection. Phase 0 of
  [plan.md](../plan.md) is already a manual verification checklist — that is the
  right shape for this.
- **Clerk sign-in**, for the same reason, plus it blocks headless outright.
- **Spotify Premium playback**, which needs a paid account and real audio.
- **Real notifications.** Permission prompts are browser chrome; Playwright can
  grant the permission but the OS-level notice is not observable.
- **Cross-browser.** Deferred until a real bug argues for it.

---

## Determinism rules

The reason e2e suites get deleted is flake. Non-negotiables:

1. **No `waitForTimeout`.** Use web-first assertions (`expect(locator).toHaveX`)
   and `expect.poll` / `toPass` for the polling paths.
2. **Fixed clock** via `pinClock` in every spec that touches the agenda, the
   focus field, or notifications.
3. **Fixed viewport** per project (`1280×800` desktop, `390×844` mobile);
   nothing depends on the runner's window.
4. **Animations off by default** (`prefers-reduced-motion`), except in the FLIP
   spec that is specifically about them.
5. **Storage cleared between specs** — Playwright's fresh context does this, but
   assert it rather than assume it.
6. **One retry in CI, zero locally.** A spec that needs two retries is a broken
   spec, not a slow one.

Budget: the whole suite under 90 seconds on one worker. Past that, it stops
being run.

---

## Decisions to make before starting

1. **Does e2e gate `npm run check`?** Recommendation: no, not initially. Add a
   separate `npm run check:all` once the suite has gone a fortnight without a
   flake, and only wire it into CI (if there ever is CI) rather than the local
   loop.
2. **Is Phase 2 alone enough?** A defensible smaller version of this plan is
   Phases 1–2 and stop: they cover the one thing jsdom structurally cannot, and
   Phases 3–5 mostly re-cover behaviour that already has tests, in a slower and
   more fragile way. If time is short, ship Phase 2 and leave the rest as a
   written intention.
3. **Where do the specs live?** `e2e/` at the root, outside `src/`, so the
   folder-as-component rule and `tsconfig.app.json` are unaffected — it will
   need its own tsconfig include or an `eslint.config.js` entry.
4. **Do the ad-hoc ADR 0011 measurement scripts get folded in?** The drag
   metrics table would be worth regenerating from the committed suite rather
   than from a script nobody has anymore.
