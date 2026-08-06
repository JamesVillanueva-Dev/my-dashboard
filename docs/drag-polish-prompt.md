# Brief: make widget dragging stop feeling glitchy

Paste everything below the line into a fresh Claude Code session in this repo.

---

# Widget drag: damp the reorder, make the animation continuous, and make touch work

Read this whole brief before writing any code. It is one deliverable in several
phases — work through them in order and **do not stop between phases to ask
whether to continue**. Stop only when a genuine fork would send the work in
materially different directions, or when you are blocked by something you cannot
decide.

## 0. Context you need first

This is a client-only React 19 + TypeScript + Vite dashboard. No backend. State
lives in `localStorage`. Panels sit in a CSS Grid the user can drag to reorder
and drag to resize.

Before writing anything, read:

- `CLAUDE.md` — project conventions. Strict, not suggestions.
- `docs/adr/0005-today-zone-and-panel-tiers.md` — why the layout is a fine-row
  CSS Grid with JS-computed row spans rather than masonry. That mechanism is the
  reason dragging is hard here, and it is not up for renegotiation.
- `src/components/Dashboard/index.tsx` — **the whole file**, but especially:
  - `positionDragged` (~line 149) — places the lifted card each frame.
  - the span effect (~line 182) — `applySize`/`applySpan` plus a `ResizeObserver`
    that re-spans a panel whenever its content changes height.
  - the FLIP effect (~line 208) — glides siblings after a reorder.
  - `reorderAround` (~line 378) — decides where the dragged panel lands.
  - `onGrab` (~line 402) — the pointer drag itself.
- `src/components/Dashboard/styles.module.css` — the grid, `.item`, `.isDragging`.
- `src/components/Widget/index.tsx` (~line 58) and its `styles.module.css`
  (`.grip`) — the handle the drag starts from.

The keyboard path (`onGripKeyDown`, the `aria-live` announcement) already works.
Do not regress it.

## 1. The problem

Dragging a panel feels glitchy and inconsistent. Two symptoms specifically, and
both have identifiable causes in the code — do not go hunting for a third before
you have fixed these.

### Symptom 1: cards flicker and swap repeatedly

`onGrab`'s `onMove` handler calls `reorderAround` on **every single
`pointermove`**, and `reorderAround` calls `setLayout`. Three things compound:

1. **No hysteresis.** `after` is decided by a bare midpoint test. Sitting near a
   boundary, one pixel of pointer jitter flips it, and the order swaps back and
   forth every event.

2. **A self-sustaining feedback loop, which is the real culprit.** A reorder
   *moves the panels*. Moving the panels changes which panel is under the
   cursor. That triggers another reorder on the next event, which moves them
   again. The oscillation sustains itself **even when the pointer is completely
   still**. Hysteresis alone will not fix this; the "what am I hovering" decision
   has to be sticky about its current target, not recomputed from scratch each
   frame.

3. **Gaps are dead zones.** `document.elementFromPoint` returns nothing useful
   over the 12px grid gap, so `closest('.item')` is null and no reorder happens
   at all — then one fires abruptly when the pointer reaches the next card. That
   reads as "sometimes it does nothing, then it jumps".

### Symptom 2: animations stutter and snap

The FLIP effect does `el.getAnimations().forEach((a) => a.cancel())` before
starting each new glide. Cancelling reverts the element instantly to its
untransformed position, and the replacement animation then starts from a delta
computed against `prevRects` — which is where the card *should* have been, not
where it visually *was* mid-glide. So every restart teleports.

It is worse than that, and you need to understand why before fixing it:
`getBoundingClientRect()` **includes** transforms from a running Web Animation.
The effect measures `next` while the previous animation may still be running, so
the rect it stores into `prevRects` is a transformed position, not a layout
position. The error compounds across reorders.

Fix both together: **measure layout positions untransformed, and animate from
where each card actually is right now.** A card caught mid-glide should pick up
smoothly from its current visual position rather than snapping back and
restarting.

### Also in scope: touch

> **Correction.** An earlier draft of this brief claimed `.grip` has no
> `touch-action`. It does — `Widget/styles.module.css` sets `touch-action: none`
> on both `.grip` and the resize `.handle`. That part is already right, so the
> touch work below is the cancel handling, the hold delay, and the hit target.
> Note also that with `touch-action: none` in force, "a swipe starting on the
> grip should scroll" is not achievable without giving up the drag; the small
> deliberate handle is the mitigation.

Alongside that:

- **There is no `pointercancel` handler.** A system gesture or scroll cancels the
  pointer stream and the drag never cleans up: the item is left with
  `pointerEvents: 'none'` and a stale transform, i.e. permanently stuck and
  unclickable. This is a real bug, not just a polish item.
- **No `setPointerCapture`.** Events are listened for on `window`, so the drag can
  be lost if the pointer leaves or another element captures it.
- **No press-and-hold delay,** so on touch any scroll that happens to start on
  the grip becomes a drag.

## 2. Non-negotiable design decisions

1. **Keep the architecture.** Custom pointer drag, FLIP for siblings, transform
   for the lifted card. **Do not add a drag library** — no dnd-kit, no
   react-beautiful-dnd, no new runtime dependency of any kind. The fix is to
   repair what is here.
2. **Keep live reflow.** Siblings should still glide into their new places in
   real time as you drag — that direct-manipulation feel is wanted. The job is to
   damp it so it settles, not to replace it with a placeholder or a
   commit-on-drop model.
3. **The reorder decision must be a pure function, in `src/lib/`.** Something like
   `dragOrder.ts`, taking cached rects, the pointer position, the current order,
   and the current target — returning the next order and target. No DOM reads, no
   React. This is what makes hysteresis testable; jsdom cannot exercise real
   pointer physics, so the logic has to be liftable out of the gesture.
4. **No layout thrash in the hot path.** `positionDragged` currently writes
   `transform = ''` and then reads `getBoundingClientRect()` on every move,
   forcing a synchronous reflow per event. Cache what you need at grab time and
   work from deltas.
5. **The keyboard path keeps working**, including the `aria-live` announcements.

## 3. Phase-by-phase work

### Phase 0 — Reproduce and instrument

Before changing behaviour, prove you can see it. Add a temporary debug overlay or
console instrumentation that logs, per drag: how many `pointermove` events fired,
how many `setLayout` calls resulted, and how many animations were cancelled
mid-flight. Run a drag and record the numbers.

Report those baseline figures. They are how you will show the fix worked, and
"reorders per drag" is the single most legible measure of the flicker.

Remove the instrumentation before you finish, or put it behind a dev-only flag —
decide which and say so.

**Acceptance:** baseline numbers for a typical drag, in your report.

### Phase 1 — The pure reorder model

Create `src/lib/dragOrder.ts`. It owns the decision the drag keeps getting wrong.

It should:

- Take the panel rects (measured once at grab time and after each committed
  reorder, not per event), the pointer position, the dragged id, the current
  order, and whatever "sticky target" state you decide on.
- Return the next order, unchanged when nothing should move — returning the same
  array reference for "no change" so callers can skip a `setLayout` entirely.
- **Apply hysteresis.** Once a panel has been placed relative to a target,
  crossing back should require travelling meaningfully past the boundary, not a
  pixel. Pick a threshold, name it as a constant, and comment what it is in terms
  of — pixels, or a fraction of the target's width.
- **Be sticky about the target.** Do not re-derive "what am I over" from scratch
  each call. Hold the current target until the pointer genuinely leaves it. This
  is what breaks the feedback loop in Symptom 1.2.
- **Handle gaps.** When the pointer is between panels, resolve to the nearest
  panel rather than returning "nothing" — the 12px gap must not be a dead zone.
- Keep the existing side-by-side vs. stacked logic from `reorderAround`: when the
  pointer is within the target's vertical band the panels are beside each other
  and the horizontal midpoint decides; otherwise the vertical one does. That part
  is correct and the grid needs it.

**Acceptance:** `src/lib/dragOrder.test.ts` covering, at minimum: no change when
the pointer has not crossed anything; a clean swap when it crosses properly; **a
jitter sequence around a boundary producing exactly one reorder, not many**; the
gap resolving to a neighbour; side-by-side vs. stacked; and the dragged panel
never reordering against itself. The jitter test is the point of this phase —
write it first.

### Phase 2 — Continuous FLIP

Rewrite the FLIP effect so animations compose instead of fighting.

- Measure **layout** positions, not transformed ones. `getBoundingClientRect()`
  reflects a running animation, so either read positions with animations
  suppressed, or use an untransformed measurement, or capture the visual offset
  separately and subtract it. Whichever you choose, comment why — the next reader
  will not know that rects include WAAPI transforms.
- When a card is mid-glide and needs a new destination, animate **from its
  current visual position**, not from the stale `prevRects` entry. Cancelling and
  restarting from a computed delta is what causes the snap.
- Fix the stale-`prevRects` problem: the span effect
  (`[enabled, sizeOf, columns]`) can move panels without the FLIP effect
  (`[enabled]`) ever running, leaving `prevRects` describing positions that no
  longer exist. Either widen the dependencies or invalidate the cache
  deliberately — and say which in a comment.
- Respect `prefers-reduced-motion`, as the current code already does.

**Acceptance:** dragging a panel back and forth across a boundary produces smooth
continuous motion with no visible snap-back. State in your report how you
verified it, and that you looked at it rather than only at tests passing.

### Phase 3 — Gesture robustness

In `onGrab` and the grip:

- **`setPointerCapture`** on the grip, and listen on that element rather than
  `window`.
- **Handle `pointercancel`** with the same cleanup as `pointerup`. Factor the
  teardown into one function so the two paths cannot drift — the stuck-panel bug
  exists precisely because there is only one exit today.
- **A small movement threshold before the lift.** A click on the grip should not
  scale-and-rotate the card. Pick a few pixels, name the constant.
- **Throttle the move handler to `requestAnimationFrame`.** `pointermove` fires
  faster than frames on a high-rate mouse; doing hit-testing and a possible
  `setLayout` per event is wasted work and adds to the thrash.
- Move `will-change: transform` off `.item` and onto `.item.isDragging`. Right
  now every panel gets a compositing layer permanently, which costs memory on a
  page with a dozen of them and buys nothing until a drag starts.
- **Suspend the content `ResizeObserver` while a drag is in flight**, or route
  its re-spans through the same FLIP path. A feed loading mid-drag currently
  reflows panels under the cursor with no animation at all.

**Acceptance:** a drag interrupted by `pointercancel` leaves no panel stuck —
test this by dispatching the event; the panel must end with no inline transform
and `pointerEvents` restored.

### Phase 4 — Touch

- ~~`touch-action: none` on `.grip`~~ — already present on both the grip and the
  resize handle. Verify rather than add.
- A **press-and-hold delay** before a touch drag begins, so scrolling a page that
  happens to start on a grip still scrolls. Mouse should stay immediate — a
  delay on mouse would feel broken. Distinguish via `event.pointerType`.
- Check the grip's hit target on touch. `controls.module.css` already documents
  the project's 44px reasoning for coarse pointers; follow it.
- Verify a drag survives a two-finger gesture arriving mid-drag (this is what
  fires `pointercancel`).

**Acceptance:** on a touch viewport, a slow drag from the grip reorders and does
not scroll the page; a swipe starting on the grip scrolls and does not reorder.

### Phase 5 — Verify it in the running app

Tests will not tell you whether this feels right. Drive the real app.

- Playwright is available via `npx playwright` with chromium already installed.
  Note that Clerk blocks headless browsing — blank `VITE_CLERK_PUBLISHABLE_KEY`
  to reach the dashboard UI.
- Drive a real drag with `page.mouse.move` in small steps across a boundary, and
  **count the reorders** against your Phase 0 baseline.
- Take screenshots mid-drag and look at them. Check both themes.
- Emulate touch (`hasTouch: true`) and repeat.

**Acceptance:** before/after reorder counts for the same gesture, and a statement
that you watched it rather than inferring from green tests.

### Phase 6 — Tests, ADR, self-review

- Unit tests for `dragOrder.ts` as described in Phase 1.
- Component tests for the cleanup paths — `pointercancel`, and the threshold not
  lifting on a click.
- Existing `Dashboard` tests must still pass, including the keyboard reorder. Do
  not weaken a test to make a change fit; if one is genuinely wrong now, say so
  explicitly in your report.
- Tests must not assert on hashed CSS class name strings — import the stylesheet
  and compare against `styles.whatever`.
- Write an ADR in `docs/adr/` (next free number) recording the reorder model: why
  the decision moved into a pure module, what the hysteresis rule is, and why a
  drag library was rejected. Follow the format of the existing ADRs, including a
  frank **Consequences** section.
- Re-read your own diff: leftover instrumentation, dead constants, comments
  describing the old behaviour.

## 4. Hard constraints

- **No new runtime dependencies.** Not for drag, not for animation, not for
  gesture handling. This is the constraint the whole project is built on.
- **Client-only**, no backend, no CDN assets.
- **CSS Modules only**, `.container` as the root, descendant selectors over
  per-element `className`s. See `CLAUDE.md`.
- **Do not change the grid mechanism.** The fine-row grid with JS row spans is
  ADR 0005 and is what allows both tight packing and column spans. Dragging has
  to work with it.
- **Resize dragging keeps working.** It shares `gridMetrics`, `applySize` and
  `applySpan` with the reorder path; do not fix one by breaking the other.
- **The keyboard path keeps working**, announcements included.
- **Preserve saved layouts.** The `layout` and `widget.sizes` keys in
  `localStorage` must keep loading.

## 5. Non-goals

Do not add auto-scroll when dragging near the viewport edge — worth having, but
it is a feature and this brief is about making what exists feel right. Do not
add drop zones, multi-select drag, or drag between regions. Do not restyle the
panels. Do not touch the Today zone, the widget menu, or any individual widget.

## 6. How to work

Make routine judgement calls yourself and keep moving. Ask only when two readings
would produce materially different work.

Report progress as you finish each phase — a line or two, not an essay. Run
`npm run lint`, `npx tsc -b`, and `npm run test:run` as you go, not only at the
end.

If a phase turns out to be blocked or a bad idea, finish every other phase in
full and tell me plainly what you skipped and why. Scaling the work down is my
call, not yours.

## 7. Definition of done

- `npm run lint`, `npx tsc -b`, and `npm run test:run` all pass.
- Dragging across a boundary no longer flickers: the reorder count for a
  controlled gesture is down from the Phase 0 baseline, with the figures in your
  report.
- A card interrupted mid-glide continues smoothly instead of snapping.
- A cancelled drag leaves nothing stuck — no stale transform, no
  `pointerEvents: 'none'`.
- Touch drag works on a phone-sized viewport, and page scrolling still works.
- Keyboard reordering and resize dragging are unaffected.
- `dragOrder.ts` is pure, exported, and unit-tested — including the jitter case.
- An ADR records the model and why no library was added.
- A final report: what you changed, the before/after numbers, what you
  deliberately did not do, and anything you found but left alone.
