/**
 * Account-synced dashboard storage.
 *
 * Widget state lives in `localStorage`, namespaced per signed-in user
 * (ADR 0003). That makes it *per browser*: signing in on a second device, or in
 * a browser that clears site data on exit, gives you an empty dashboard even
 * though you are the same person. This module lifts the user-authored part of
 * that state onto the Clerk account itself, so it follows the account instead.
 *
 * Clerk's `unsafeMetadata` is writable from the browser with no server of our
 * own, which is why it can carry this without breaking ADR 0001 — the same
 * reasoning that let Clerk supply auth in the first place (ADR 0003). "Unsafe"
 * names its trust level, not its safety: the owner can edit it from their own
 * browser, so it must never be used for authorization. Dashboard preferences are
 * exactly what it is for.
 *
 * The cost is a hard **8KB cap** across all of a user's metadata. That is
 * comfortable for preferences and painful for prose, so {@link overBudget}
 * exists to make an oversized snapshot fail loudly at the call site rather than
 * be silently truncated. Losing a user's notes to a quota nobody mentioned would
 * be worse than refusing to save them.
 */

/**
 * The keys that follow the account, as written by `useLocalStorage` (i.e. before
 * the per-user scope prefix is applied).
 *
 * An allowlist rather than "everything in localStorage", because two categories
 * of key must stay on the device:
 *
 * - **`cache:*`** — cached weather and headlines. Public, refetchable, and large
 *   enough on its own to blow the metadata budget.
 * - **`gcal.syncToken`** — Google's incremental-sync cursor. It records what
 *   *this browser* has already seen; copying it to another device would make
 *   that device resume from a position it never reached and silently skip every
 *   event in between. Sync state is per-replica by definition.
 *
 * Spotify's OAuth token is absent for the same reason it lives in
 * `sessionStorage` (ADR 0006): credentials do not belong in synced storage.
 */
export const SYNCED_KEYS = [
  // Layout and identity
  'user.name',
  'layout',
  'widget.sizes',
  'theme',
  // Today zone
  'today.showFocus',
  'focus',
  // Tasks
  'reminders',
  'tasks.mergedTodos',
  // Widgets
  'notes.text',
  'quicklinks',
  'weather.place',
  'weather.unit',
  'news.sources',
  'news.feed',
  'youtube.sources',
  'youtube.current',
  'spotify.sources',
  'spotify.current',
  'spotify.volume',
  // Google Calendar: which calendar and whether the user wants it connected.
  // Deliberately not `gcal.syncToken` — see above.
  'gcal.calendarId',
  'gcal.connected',
  'gcal.view.connected',
] as const;

/** Local bookkeeping key recording when synced data last changed in this browser. */
export const LOCAL_STAMP_KEY = 'profile.updatedAt';

/** The property on `unsafeMetadata` that holds {@link ProfileSnapshot}. */
export const METADATA_KEY = 'dashboard';

/**
 * Clerk's documented ceiling for a user's metadata is 8KB. The snapshot is held
 * a little under it, so the envelope Clerk wraps it in cannot tip a payload that
 * measured as fitting over the edge server-side.
 */
export const BUDGET_BYTES = 7000;

/** Everything the dashboard syncs, plus when it was last changed. */
export interface ProfileSnapshot {
  /** Bumped if the shape changes; older snapshots are ignored rather than parsed. */
  v: 1;
  /** Epoch ms of the most recent local change, used to settle conflicts. */
  updatedAt: number;
  /** Raw stored JSON, keyed by unscoped key. Absent keys were never set. */
  data: Record<string, string>;
}

/** Prefixes `key` with `scope`, matching `useLocalStorage`'s own scoping. */
function scoped(scope: string, key: string): string {
  return scope ? `${scope}:${key}` : key;
}

/** Reads the local change stamp, or 0 when this browser has never written one. */
export function localStamp(scope: string): number {
  try {
    const raw = window.localStorage.getItem(scoped(scope, LOCAL_STAMP_KEY));
    const n = raw === null ? 0 : Number(JSON.parse(raw));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Records that synced data changed locally at `at`. */
export function markLocal(scope: string, at: number = Date.now()): void {
  try {
    window.localStorage.setItem(scoped(scope, LOCAL_STAMP_KEY), JSON.stringify(at));
  } catch {
    // Storage unavailable; sync degrades to "push what we have", which is fine.
  }
}

/**
 * Gathers this browser's synced keys into a snapshot.
 *
 * Only keys that are actually present are included, so a fresh account does not
 * publish a wall of defaults that would later win a conflict against a device
 * where the user had really set something.
 */
export function collect(scope: string): ProfileSnapshot {
  const data: Record<string, string> = {};
  for (const key of SYNCED_KEYS) {
    try {
      const raw = window.localStorage.getItem(scoped(scope, key));
      if (raw !== null) data[key] = raw;
    } catch {
      // Skip unreadable keys rather than abandoning the whole snapshot.
    }
  }
  // Strictly the stamp, never a fallback to "now": a browser that has never
  // recorded a change must compare as *older* than the account. Dating it to the
  // present would make every fresh device look newer than the real dashboard and
  // push its emptiness over the top.
  return { v: 1, updatedAt: localStamp(scope), data };
}

/**
 * Writes a snapshot's values into this browser's storage.
 *
 * A key the snapshot omits is *removed* locally, not left behind: the snapshot
 * is the account's whole synced state, so a source the user deleted on another
 * device has to disappear here too rather than be resurrected on the next push.
 */
export function apply(scope: string, snapshot: ProfileSnapshot): void {
  for (const key of SYNCED_KEYS) {
    const full = scoped(scope, key);
    try {
      const value = snapshot.data[key];
      if (value === undefined) window.localStorage.removeItem(full);
      else window.localStorage.setItem(full, value);
    } catch {
      // Ignore individual failures; a partial apply still beats none.
    }
  }
  markLocal(scope, snapshot.updatedAt);
}

/** Parses whatever Clerk handed back, returning `null` for anything unusable. */
export function readSnapshot(metadata: unknown): ProfileSnapshot | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>)[METADATA_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const snap = raw as Partial<ProfileSnapshot>;
  if (snap.v !== 1 || typeof snap.updatedAt !== 'number' || !snap.data) return null;
  if (typeof snap.data !== 'object') return null;
  return { v: 1, updatedAt: snap.updatedAt, data: snap.data as Record<string, string> };
}

/** Serialised size of a snapshot in bytes, as Clerk will measure it. */
export function measure(snapshot: ProfileSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).length;
}

/**
 * The keys pushing a snapshot over the metadata budget, largest first, or an
 * empty array when it fits.
 *
 * Returning the culprits rather than a bare boolean is the point: told "sync
 * failed", a user can do nothing, but told "your notes are 6KB", they can.
 */
export function overBudget(snapshot: ProfileSnapshot): string[] {
  if (measure(snapshot) <= BUDGET_BYTES) return [];
  return Object.keys(snapshot.data).sort(
    (a, b) => snapshot.data[b].length - snapshot.data[a].length,
  );
}

/**
 * Decides what should happen when local and remote both exist.
 *
 * Last-write-wins on `updatedAt`. Coarse, but the alternative — merging two
 * divergent dashboards field by field — needs a per-key change history this
 * deliberately does not keep, and would still guess wrong about which of two
 * edited note bodies the user meant.
 */
export function resolve(
  local: ProfileSnapshot,
  remote: ProfileSnapshot | null,
): 'push' | 'pull' | 'idle' {
  if (!remote) return Object.keys(local.data).length > 0 ? 'push' : 'idle';
  if (remote.updatedAt > local.updatedAt) return 'pull';
  if (local.updatedAt > remote.updatedAt) return 'push';
  return 'idle';
}
