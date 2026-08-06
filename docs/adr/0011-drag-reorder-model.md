# ADR 0011: Where a dragged panel lands is decided by a pure model, not by hit-testing the cursor

- **Status:** Accepted
- **Date:** August 5, 2026
- **Deciders:** Project owner

## Context

Reordering panels felt glitchy and inconsistent. The reported symptoms were
cards flickering and animations snapping, so the obvious suspects were a missing
hysteresis on the midpoint test and the FLIP effect's
`getAnimations().forEach((a) => a.cancel())`.

Measuring first changed the diagnosis. Driving a real drag in Chromium with the
gesture instrumented:

- **Holding the pointer completely still produced zero reorders.** There was no
  self-sustaining oscillation; `reorderAround` only ran from `onMove`, so with
  no pointer movement nothing could fire. A feedback loop had been assumed and
  it did not exist.
- **The drag was not over-reacting. It was barely reacting.** Two full sweeps
  across a five-panel grid — four traversals — committed **4** reorders in
  total.
- **97% of hit-tests found nothing at all.** Of 72 samples during a drag, 70 had
  `document.elementFromPoint` return the grid container rather than a panel; 2
  found a real target.

That last figure is the whole story. The layout is a fine-row grid with
`align-items: start` (ADR 0005), so a panel occupies only as much of its column
as its content needs. Most of the grid's area is therefore *not* a panel — the
12px gutters, and the large empty region below every short panel. Asking "what
is under the cursor" has no useful answer most of the time, so the layout mostly
did not respond, then lurched several positions at once when the pointer
happened to cross a card. Read as a user rather than as a measurement, that is
exactly "flickering and inconsistent".

The animation complaint was real and separate. `getBoundingClientRect()`
**includes** transforms from a running Web Animation, so the FLIP effect stored
transformed positions as if they were layout positions, and the error compounded
across reorders. Cancelling in-flight animations and restarting from that stale
delta is what made cards teleport.

## Decision

**Replace point hit-testing with a pure, testable reorder model, and make the
FLIP composite rather than restarting.**

1. **`src/lib/dragOrder.ts` owns the decision.** A pure synchronous function
   over cached rects, the pointer position, the current order, and the target
   the previous step settled on. No DOM, no React. jsdom cannot exercise pointer
   physics, so the only way to test damping is to lift it out of the gesture.

2. **Nearest panel, never "nothing".** `resolveTarget` returns the closest panel
   by distance-to-box, so the gutters and the empty space below a short panel
   belong to whichever card is nearest. This is what removes the dead zones, and
   it is the single change that made the drag responsive.

3. **Two independent dampers.** `FLIP_HYSTERESIS` (12%, capped by
   `FLIP_HYSTERESIS_MAX` at 24px) is a dead band around a panel's midpoint that
   stops the *side* flapping. `TARGET_STICKINESS` (24px) holds the current
   target until the pointer clearly leaves it, which stops the *target* flapping
   when a reorder shuffles panels under the cursor. They damp different things
   and both are needed.

   The pixel cap is not decoration. As a bare fraction, a 700px-wide panel
   demanded 84px of committed travel before it would change sides, and a
   measured sweep produced **zero** reorders — the damping had turned into
   unresponsiveness. Jitter is 1–3px, so a couple of dozen pixels already clears
   it by an order of magnitude.

4. **Reference equality means "nothing moved".** `stepDrag` returns the *same*
   order array when there is nothing to do, so the caller skips `setLayout`
   entirely rather than re-rendering on every pointer event.

5. **Composite FLIP.** The new delta is
   `(previous layout − new layout) + current transform`. Reading the in-flight
   offset *before* cancelling, and deriving the layout box by subtracting it,
   means a card interrupted mid-glide continues from where it visually is
   instead of snapping back. With nothing running the offset is zero and this is
   the ordinary FLIP delta.

6. **One exit from the gesture.** `pointerup` and `pointercancel` both call the
   same `finish`. The stuck-panel bug existed precisely because there was only
   one exit and `pointercancel` was not it — a cancelled drag left the panel
   transformed and its listeners attached.

7. **A movement threshold and a touch hold.** `DRAG_THRESHOLD` (4px) stops a
   plain click lifting the card; `TOUCH_HOLD_MS` (180ms) makes a finger commit
   before it gets a drag, and a touch that moves before the hold elapses is
   released as a scroll.

## Consequences

**Positive**

- **The drag follows the pointer.** On the same measured gesture — two sweeps
  across a five-panel grid — reorders went from **4 to 30**, while a ±3px jitter
  at a boundary still commits **0**. Responsive and damped are no longer in
  tension because they are handled by different mechanisms.
- **The damping is arguable.** Every constant is named, exported, and unit
  tested, including a jitter sequence asserting exactly one reorder for 40
  samples across a boundary.
- **Cheaper hot path.** `positionDragged` no longer clears the transform and
  re-measures on every event (a forced synchronous reflow per move), the move
  handler is throttled to `requestAnimationFrame`, and `will-change: transform`
  moved off every panel onto only the one being dragged.
- **`pointer-events: none` on the lifted card is gone**, because the only reason
  for it was letting `elementFromPoint` see through the card.

**Negative**

- **Nearest-panel resolution is a guess in open space.** Dragging far below the
  grid resolves to whatever card is closest, which is defensible but arbitrary.
  Point hit-testing was at least honest about not knowing.
- **Two damping constants interact**, and neither is derivable from first
  principles. They were tuned against one viewport and one panel arrangement;
  a very different layout could want different numbers.
- **Rects are cached, not live.** They refresh when the order changes, so a
  panel that resizes itself mid-drag is briefly modelled at its old size. The
  content `ResizeObserver` is suspended during a drag for the same reason.
- **The touch hold adds latency** to a deliberate touch drag, and 180ms is a
  guess that has not been tried on real hardware.

## Validation

Measured in Chromium via Playwright, same script against both implementations:

| Gesture | Before | After |
| --- | --- | --- |
| Two sweeps across a 5-panel grid | 4 reorders | 30 reorders |
| Jitter ±3px × 20 at a boundary | 0 | 0 |
| Pointer held still for 1s | 0 | 0 |
| Hit-tests finding no panel | 70 / 72 | n/a — no hit-testing |

Plus 18 unit tests for the model and component tests for the cancel and
threshold paths.

**Not verified on real touch hardware.** The touch path is exercised only by
reasoning and by the emulator; `TOUCH_HOLD_MS` in particular should be expected
to move.

## Alternatives considered

- **Adding a drag library (dnd-kit).** Rejected: a new runtime dependency in a
  project that has none, and the grid integration — row spans, FLIP, the resize
  drag sharing `gridMetrics` — would have been rewritten anyway. The defect was
  a wrong question, not a missing framework.
- **Keeping `elementFromPoint` and adding hysteresis.** This was the original
  plan, and the measurement killed it: damping a signal that is absent 97% of
  the time does not help.
- **Making panels fill their grid tracks** so hit-testing would work. Rejected:
  it would undo ADR 0005's tight packing, which is the reason the grid looks
  the way it does.
- **An insertion placeholder instead of live reflow.** Calmer, and near
  impossible to make flicker. Rejected because the direct-manipulation feel of
  siblings gliding in real time is wanted; the goal was to damp it, not to
  replace it.
- **Listening on the grip via `setPointerCapture` alone.** Tried, and it broke
  the drag outright: capture did not survive the re-render, events then
  hit-tested to the lifted card, and the gesture received a single `pointermove`
  before going silent. Capture is still set — it helps on touch and off-window —
  but the listeners are on `window`, which receives the events either way.
