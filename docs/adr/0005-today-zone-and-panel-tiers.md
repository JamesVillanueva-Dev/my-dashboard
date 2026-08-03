# ADR 0005: A Today zone, tiered panels, and one task list

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Project owner

## Context

The dashboard rendered nine widgets into a CSS multi-column masonry. Every panel
had identical visual weight and identical width, so the Spotify player competed
with the day's schedule and the reading order was an accident of panel heights.
Nothing on the page answered *what should I be doing right now?* — that required
reading four panels and merging them mentally.

Three things caused that, and only the first is cosmetic:

1. **The layout could not express importance.** Multi-column masonry gives every
   column one width and no way to span, so there was nowhere to put hierarchy.
2. **Commitments were split across four surfaces.** Calendar events, Reminders,
   To-do items, and the daily Focus were four lists in four boxes.
3. **Two of those surfaces were the same data.** A `Task` was `{id, text, done}`;
   a `Reminder` was `{id, text, due, done, …}`. A to-do was a reminder without a
   date. The redundancy was in the model, not just the layout.

## Decision

**1. A fixed Today zone leads the page.** A full-width hero above the grid shows
the next commitment with a live relative countdown, the day's focus, aggregate
counts, and one merged timeline of today's events and dated tasks. It is part of
the dashboard frame, not an entry in the widget registry: it cannot be dragged or
removed, because it is the thing the rest of the page hangs off.

**2. Panels declare a tier, expressed as density.** `WidgetSize` is `standard`
(surfaces you act on — Tasks, Calendar) or `compact` (reference — Weather, News,
Notes, Quick Links, Spotify). Compact panels get tighter padding and a smaller
type scale.

**3. To-do merged into Reminders as a single Tasks list.** A dated task syncs to
Google Calendar; an undated one stays local, which `gcalSync.ts` already handled.
A one-time, idempotent migration in `lib/tasks.ts` folds legacy `todos` in as
undated tasks with a `todo-` id prefix.

**4. Shared state moved into `DashboardDataProvider`.** Tasks, calendar events,
and the derived agenda are owned once and handed to every consumer.

## Consequences

**The masonry stays, and tiers are density-only.** This is the significant
trade-off. Real column spans need CSS Grid, but Grid aligns every item in a row
to the tallest one, which reintroduces the dead whitespace masonry exists to
avoid. CSS masonry (`grid-template-rows: masonry`) is not shipped in stable
browsers, so *packing* and *spanning* cannot both be had today. We kept packing:
hierarchy comes from the hero, from density, and from default order. `.standard`
and `.compact` classes are applied by the grid so a future Grid-based layout can
hang a span off them without touching the registry.

**The drag interaction is untouched.** Because the masonry survived, the pointer
drag, its `elementFromPoint` hit-testing, and the FLIP animation all still work
unmodified. Had we switched to Grid, the vertical-midpoint logic in
`reorderAround` would have needed rewriting for side-by-side items.

**No layout migration was needed.** Size is a property of the registry, not of
the saved layout, so `layout` remains `string[]` and existing values load
untouched. Retired ids (`todo`, `focus`) are dropped by the pre-existing
`widgetById` guard; there is a regression test for that.

**`useDashboardData` throws outside its provider.** A widget cannot fall back to
its own `useLocalStorage` copy without reintroducing the divergence the provider
exists to prevent — two instances of the same key are two React states writing
one slot, last writer wins. Failing loudly is correct, but it means tests for
`RemindersWidget`, `CalendarWidget`, and `TodayPanel` must supply a provider.

**The legacy `todos` key is never deleted.** It stays in `localStorage` as a
manual rollback path. The merge is guarded by a `tasks.mergedTodos` flag and is
idempotent regardless.

**Losses.** `FocusWidget`'s rotating daily quote was dropped when the focus field
moved into the Today zone. Users who deliberately kept To-do and Reminders as
separate lists now see one combined list.
