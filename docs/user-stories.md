# User Stories

Written from the perspective of the primary user: someone who opens this
dashboard as a personal "home base" in the browser. Each story has acceptance
criteria; a ✅ marks behaviour implemented today, ⏳ marks a planned follow-up.

Format: _As a **user**, I want **X**, so that **Y**._

---

## Epic: At-a-glance information

### US-1 — Weather ✅
As a user, I want to see current weather and a short forecast, so that I can plan
my day.

**Acceptance criteria**
- ✅ Shows current temperature, condition, "feels like", high/low, humidity, wind.
- ✅ Shows a multi-day forecast.
- ✅ I can search for a city, or use my current location.
- ✅ I can switch between °F and °C, and my choice is remembered.
- ✅ If the request fails, I see an error with a Retry button (not a blank card).

### US-2 — News ✅
As a user, I want recent headlines from sources I choose, so that I stay current.

**Acceptance criteria**
- ✅ Lists recent headlines with a relative timestamp ("2h ago").
- ✅ I can switch between multiple sources (Top, World, Tech, NPR, Hacker News).
- ✅ Headlines open in a new tab.
- ✅ I can refresh, and failures show a Retry.
- ✅ My selected source is remembered.

---

## Epic: Personal notes & tasks

### US-3 — Notes ✅
As a user, I want a scratchpad, so that I can jot things without another app.

**Acceptance criteria**
- ✅ Free-form text that autosaves as I type.
- ✅ Content persists across reloads (this browser).
- ⏳ Sync with my Google Docs (requires Google sign-in — future).

### US-4 — Reminders ✅
As a user, I want reminders with optional due times, so that I don't forget things.

**Acceptance criteria**
- ✅ Add a reminder with text and an optional date/time.
- ✅ Incomplete items sort first (soonest due first); done items sink.
- ✅ Overdue, not-done items are visually highlighted.
- ✅ I can check off or delete a reminder.
- ⏳ Local browser notifications at the due time (future).

### US-5 — To-do ✅
As a user, I want a simple checklist separate from timed reminders, so that I can
track tasks.

**Acceptance criteria**
- ✅ Add tasks; newest appears on top.
- ✅ Check off tasks; completed ones move to the bottom.
- ✅ See a count of remaining tasks.
- ✅ Delete a task.

### US-6 — Focus of the day ✅
As a user, I want to set one daily intention and see a motivating quote, so that
I stay focused.

**Acceptance criteria**
- ✅ A single focus field that resets each calendar day.
- ✅ A "quote of the day" that is the same for everyone on a given date.
- ✅ The focus text persists during the day.

### US-7 — Quick links ✅
As a user, I want one-click shortcuts to my sites, so that I can navigate fast.

**Acceptance criteria**
- ✅ A grid of bookmarks with site favicons.
- ✅ Add a link (label + URL; scheme optional) and remove links.
- ✅ Links persist and open in a new tab.

---

## Epic: Make it mine (personalisation)

### US-8 — Theme ✅
As a user, I want to choose the colour theme, so that the dashboard suits me.

**Acceptance criteria**
- ✅ Default black & yellow theme; purple/blue as an alternate.
- ✅ Initial theme follows my operating-system light/dark setting.
- ✅ A header toggle switches themes and remembers my choice.
- ✅ The favicon reflects the active light/dark theme.

### US-9 — Editable greeting ✅
As a user, I want the dashboard to greet me by name, so that it feels personal.

**Acceptance criteria**
- ✅ Time-appropriate greeting (morning/afternoon/evening/night).
- ✅ I can click my name to edit it; it persists.
- ✅ A live clock and today's date are shown.

### US-10 — Manage widgets (movable & removable) ✅
As a user, I want to choose which widgets appear and arrange them, so that the
layout fits how I work.

**Acceptance criteria**
- ✅ A widget menu lists every widget with a checkbox to show/hide it.
- ✅ I can remove a widget directly via an `×` on its card.
- ✅ I can drag a widget by its handle to reorder the grid.
- ✅ The set and order of widgets persist across reloads.
- ✅ I can reset to the default layout.
- ✅ If I remove everything, I get a friendly empty state pointing to the menu.

---

## Epic: Trust & robustness

### US-11 — Works offline-first for my data ✅
As a user, I want my personal data to stay on my device, so that it's private and
available without an account.

**Acceptance criteria**
- ✅ Notes, reminders, to-dos, links, focus, layout, name, and theme are stored
  locally; no account or backend is required.
- ✅ The app loads and is usable even when network widgets can't reach the internet.

### US-12 — No dead ends ✅
As a user, I want the app to degrade gracefully, so that one failing feature
doesn't break the page.

**Acceptance criteria**
- ✅ Network widgets show loading/error/retry states.
- ✅ Corrupt stored data falls back to defaults instead of crashing.

---

## Planned (future phases)

- ⏳ **US-13 — Google Docs & Calendar** (OAuth + backend): real notes and events.
- ⏳ **US-14 — Cross-device sync** of settings and personal data.
- ⏳ **US-15 — More widgets**: stocks/crypto, Pomodoro timer, habit tracker.
