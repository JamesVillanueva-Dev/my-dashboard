# Redesign brief: from widget board to life dashboard

Paste everything below the line into a fresh Claude Code session in this repo.

---

# Dashboard redesign: information architecture, layout engine, and unified agenda

This is a large, multi-phase piece of work. Read the whole brief before starting.
Work through the phases in order, and **do not stop between phases to ask whether to
continue** — the phases are one deliverable. Only stop to ask when a genuine fork in
the design would send the work in materially different directions, or when you are
blocked by something you cannot decide yourself.

## 0. Context you need before writing any code

This is a client-only React 19 + TypeScript + Vite dashboard. There is no backend.
All state lives in `localStorage`, with optional Google Calendar sync (GIS token
flow) and optional Clerk authentication. Both integrations are opt-in via env vars
and the app runs fully with neither configured.

Before doing anything else, read:

- `CLAUDE.md` — project conventions. These are strict, not suggestions. Folder-as-
  component with `index.tsx` + `styles.module.css` + `index.test.tsx`, exactly one
  components directory, CSS Modules only, `.container` is always the root element,
  descendant selectors preferred over per-element `className`s, shared primitives via
  `composes` from `src/styles/controls.module.css`.
- `docs/adr/0001` through `0004` — settled architectural decisions. Do not relitigate
  them. In particular: client-only, no backend, no server-side secrets.
- `src/components/Dashboard/index.tsx` — layout state, the custom pointer drag, and
  the FLIP reorder animation.
- `src/components/Widget/index.tsx` and `chrome.ts` — the panel shell and the
  grid↔widget context contract.
- `src/lib/registry.tsx` — the widget catalogue and default layout.
- `src/hooks/useLocalStorage.ts` — how persistence works.
- `src/lib/gcalEvents.ts`, `src/lib/gcalSync.ts` — the calendar event shape and the
  reminder↔event mapping, which you will need for the agenda model.

Current widgets: Focus of the Day, Weather, Calendar, Reminders, To-do, News, Notes,
Quick Links, Spotify. Each renders through the shared `<Widget>` shell into a CSS
multi-column masonry, and the user can drag panels to reorder them.

## 1. The problem

The app works and the individual widgets are fine. The *dashboard* is not. It reads
as a pile of unrelated boxes rather than something I would run my life from:

1. **No hierarchy.** Every panel has identical visual weight and near-identical
   width. The Spotify player is as prominent as today's schedule. Importance is not
   encoded anywhere in the layout, so my eye has nowhere to land first.
2. **No "now".** Nothing answers *what should I be doing right now?* I have to read
   four separate panels and assemble the answer in my head.
3. **Four disconnected commitment surfaces.** Focus of the Day, To-do, Reminders, and
   Calendar are all "things I have committed to", stored separately, rendered
   separately, never shown together.
4. **No aggregate state.** Nothing tells me "3 things left today", "next meeting in
   40 minutes", or "2 overdue" without opening a panel and counting manually.
5. **Arbitrary ordering.** Masonry packs by column height, so what I see first is an
   accident of panel heights, not a decision anyone made.
6. **Uniform density.** A five-item news list and a one-line focus note get the same
   padding, the same type scale, and the same visual priority.

## 2. The target

Restructure around **time and attention** rather than around **data source**. Three
tiers:

**Tier 1 — Today.** A prominent lead zone spanning the full content width, above
everything else. It answers "what's happening and what do I owe". It contains:

- The next upcoming commitment with a live relative countdown ("in 40 minutes"),
  falling back gracefully when nothing is scheduled.
- A single merged, time-ordered agenda for today drawn from calendar events,
  reminders with due dates, and to-dos with due dates.
- The current Focus of the Day, treated as the one prominent intention.
- A compact strip of aggregate counts: remaining today, overdue, events left.

**Tier 2 — Manage.** The full Reminders and To-do panels at standard size. These stay
the editing surfaces — Tier 1 reads from them and never owns their data. Calendar
also sits here at standard size.

**Tier 3 — Ambient.** Weather, News, Notes, Quick Links, Spotify. Smaller, denser,
visually quieter. Reference material, not decisions.

Hierarchy must come from **size, density, placement, and type scale** — not from
introducing new accent colours. The existing palette stays as it is.

## 3. Phase-by-phase work

### Phase 0 — Recon and plan

Read the files listed in section 0. Then propose, in prose plus a rough ASCII sketch:
the zone layout at desktop width, which widget lands in which tier, the size values
you intend to add, and the grid mechanism you will use. Flag anything in the existing
code that will fight this change.

Show me this before writing component code. I would much rather correct the structure
on paper than after it is built. Once I have responded, continue through the
remaining phases without further check-ins unless something genuinely forks.

**Acceptance:** a plan I can react to, naming specific files you will change.

### Phase 1 — Layout engine

This is the single most important structural change: it is what turns a grid of
equals into a hierarchy.

- Add a size to each entry in `src/lib/registry.tsx` — something like
  `'hero' | 'standard' | 'compact'`. Type it properly and document what each means.
- Replace the CSS multi-column masonry in `src/components/Dashboard/styles.module.css`
  with a real CSS Grid that can span columns. **Note the trap:** CSS multi-column
  cannot span items, which is exactly why the current layout cannot express
  hierarchy. The grid mechanism has to change outright, not be tweaked.
- Define responsive behaviour at every breakpoint the app already supports (there are
  existing 640px and 560px breakpoints — keep them meaningful). Hero spans full
  width; standard and compact reflow sensibly; everything collapses to one column on
  mobile.
- **Drag-to-reorder must keep working.** `Dashboard/index.tsx` runs a custom pointer
  drag with a FLIP animation, `document.elementFromPoint` hit-testing, and a drop
  animation. Changing the grid will affect all of it. Verify: the lifted panel tracks
  the cursor, siblings glide out of the way, the drop animation lands, and the
  reorder persists. Fix what breaks.
- **Migrate saved layouts.** I have a `layout` array in `localStorage` from the
  current version right now. A saved layout from before this change must still load
  without throwing or blanking the page. There is already a guard for unknown ids
  (`layout.filter((id) => widgetById(id))`) — extend that thinking to the new shape,
  and write a test that feeds an old-format value through and asserts a sane result.

**Acceptance:** panels render at three distinct sizes, dragging still reorders and
persists, an old saved layout loads cleanly, and all breakpoints behave.

### Phase 2 — The agenda model

Add a module in `src/lib/` (something like `agenda.ts`) that merges commitments into
a single time-ordered stream. This is pure logic — no React, no DOM, fully unit
tested.

It should:

- Accept calendar events, reminders, and to-dos, and normalise them into one item
  type carrying at minimum: source, id, title, timestamp (or all-day flag), done
  state, and a link back to the owning widget.
- Sort by time, with all-day items first within a day, matching the existing
  convention in `gcalEvents.ts`.
- Expose helpers for: today's items, the next upcoming item, overdue items, and the
  aggregate counts Tier 1 needs.
- Handle the awkward cases explicitly: all-day events, multi-day events spanning
  today, items with no date at all, items already marked done, and events that have
  already started but not ended ("in progress").
- Be timezone-correct using local time, consistent with how `calendarGrid.ts` and
  `gcalSync.ts` already handle dates. Do not introduce a date library.

Do not delete, fork, or reimplement the existing widgets. They keep owning their own
data and their own storage keys; the agenda reads across them.

**Acceptance:** thorough unit tests in `src/lib/agenda.test.ts` covering every case
above, including the boundaries (midnight, all-day vs timed on the same day, an event
in progress right now).

### Phase 3 — Tier 1 components

Build the Today zone. Create each new component with `npm run create:component` so
the scaffolding matches conventions — do not hand-roll the folders.

Likely components, though use your judgement on the exact split:

- A container for the Today zone.
- A "next up" element with a live relative countdown. It must update on an interval
  and clear that interval on unmount. Pick a sensible tick rate — one second is
  wasteful for a countdown displayed in minutes.
- A merged agenda list rendering the model from Phase 2, visually distinguishing
  sources (calendar / reminder / to-do) using the existing `Icon` set.
- The aggregate count strip.

Toggling an item done from the Today zone should write through to the widget that
owns it, and the owning widget must reflect it. If that is not achievable without
restructuring state ownership, make the Today items read-only, and say so explicitly
in your final report rather than half-implementing it.

Handle empty states properly — a new user with no calendar connected and nothing
scheduled should see something intentional and welcoming, not a blank box.

**Acceptance:** Tier 1 renders from real widget data, the countdown ticks and cleans
up, empty states are designed, component tests cover the rendering and the empty
case.

### Phase 4 — Density and the panel shell

- Teach `<Widget>` about size so compact panels get tighter padding, a smaller type
  scale, and denser lists. Keep using the recessed well treatment (`--well`,
  `--well-shadow` in `src/styles.css`) — this is about density, not a new look.
- Audit each Tier 3 widget for what should be hidden or truncated at compact size.
  News showing nine full headlines is a Tier 3 panel behaving like a Tier 1 one.
- Keep both light and dark themes correct throughout. Check both.

**Acceptance:** compact panels are visibly denser and quieter than standard ones, in
both themes.

### Phase 5 — Fix what is already broken

- **Reminders header overflow.** The "Synced" status, refresh button, and "Disconnect"
  link collide with the panel title at narrow column widths. Fix properly — the
  header needs a real layout strategy, not a nudge.
- **`WidgetDef.icon` is half-wired.** It is only consumed by the widget menu; panel
  headers render no icon because no widget passes `icon` to `<Widget>`. Either wire it
  through every widget or delete the prop. Decide and be consistent.
- Sweep for any other visual bug you notice while working. Report anything you find
  but choose not to fix.

**Acceptance:** the Reminders header holds together at the narrowest column width the
grid produces; the icon story is consistent either way.

### Phase 6 — Accessibility and keyboard support

- **Reordering is currently mouse-only.** The drag grip in `Widget/index.tsx` has
  `role="button"` and an `onPointerDown` handler, but no keyboard path — so panels
  cannot be reordered without a pointer. Add a keyboard affordance: make the grip
  focusable and let arrow keys move a panel, with an `aria-live` announcement of the
  new position.
- Verify focus management in the modals still works after the layout change.
- Respect `prefers-reduced-motion` in any new animation, matching the existing FLIP
  code which already checks it.
- Check heading hierarchy across the new zones — there should be one `h1`, and panel
  titles should not skip levels.

**Acceptance:** a panel can be moved and its new position announced without touching
a mouse.

### Phase 7 — Tests, docs, and self-review

- Unit tests for all new `src/lib/` logic.
- Component tests for every new component.
- Update existing tests the redesign invalidates. Tests must not assert on hashed
  class name strings — import the stylesheet and compare against `styles.whatever`.
- Write an ADR in `docs/adr/` recording the layout-engine decision: why CSS Grid with
  declared sizes replaced multi-column masonry, and what it costs. Follow the format
  of the existing ADRs.
- Update `README.md` if any of it is now wrong.
- Re-read your own diff before declaring done. Look for dead code, leftover
  scaffolding comments from `create:component`, unused imports, and copy-pasted
  blocks that should be shared.

## 4. Hard constraints

- **Client-only.** No backend, no new runtime dependencies, no CDN assets, no
  external fonts or images (ADR 0001). Icons are inline SVG in
  `src/components/Icon/` — extend that set rather than adding an icon library.
- **CSS Modules only.** No inline styles, no utility classes, no global CSS outside
  `src/styles.css`.
- **Keep the current visual language.** Recessed well panels, sticky full-bleed nav
  bar, existing palette and tokens. Both themes must work.
- **Do not break the optional-integration model.** The app must still run correctly
  with no `VITE_GOOGLE_CLIENT_ID` and no `VITE_CLERK_PUBLISHABLE_KEY`. Test that path
  — it is the default for a new user.
- **Preserve all existing user data** in `localStorage`. Storage keys for notes,
  todos, reminders, links, and theme must not change.

## 5. Non-goals

Do not add new integrations (no Gmail, no Docs, no Spotify API auth). Do not add a
settings page. Do not add routing. Do not restyle the nav bar or the greeting. Do not
change the auth flow.

## 6. How to work

Make routine judgement calls yourself and keep moving. Ask only when two readings
would produce materially different work.

Report progress as you complete each phase — one or two lines, not an essay. If a
phase turns out to be blocked or a bad idea, finish every other phase in full and
tell me plainly what you skipped and why. Scaling the work down is my call, not
yours.

Run `npm run lint`, `npx tsc -b`, and `npm run test:run` as you go, not just at the
end — catching a type error three phases late is expensive.

## 7. Definition of done

- `npm run lint`, `npx tsc -b`, and `npm run test:run` all pass.
- New `src/lib/` logic has unit tests; new components have component tests.
- An old `localStorage` layout loads without error.
- The app runs correctly with no env vars configured.
- Both light and dark themes are correct at desktop, tablet, and mobile widths.
- Drag reordering works, and keyboard reordering works.
- An ADR records the layout decision.
- A final report stating what you did, what you deliberately did not do, and anything
  you found but chose to leave alone.
