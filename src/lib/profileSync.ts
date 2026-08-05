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
 * Not everything should be identical everywhere, though. A three-column desktop
 * arrangement is not a phone layout, so the snapshot splits in two: a shared
 * core that follows you everywhere, and a per-form-factor slice holding the
 * things that describe the *shape* of the dashboard. See {@link DEVICE_KEYS}.
 *
 * The cost is a hard **8KB cap** across all of a user's metadata. That is
 * comfortable for preferences and painful for prose, so {@link overBudget}
 * exists to make an oversized snapshot fail loudly at the call site rather than
 * be silently truncated. Losing a user's notes to a quota nobody mentioned would
 * be worse than refusing to save them. Splitting layout per device costs little
 * against that budget — an id list and a small map — which is why only layout is
 * duplicated and content never is.
 */

/** Which shape of device a dashboard layout was arranged for. */
export type FormFactor = 'desktop' | 'mobile';

/**
 * Which kind of device this is.
 *
 * Deliberately `pointer: coarse` (the query the touch styles already use) rather
 * than a width breakpoint: it describes the *device*, so narrowing a desktop
 * window cannot flip you into the phone's layout and start saving over it.
 */
export function detectFormFactor(): FormFactor {
  return window.matchMedia?.('(pointer: coarse)').matches ? 'mobile' : 'desktop';
}

/**
 * Keys describing the dashboard's shape, kept separately per form factor.
 *
 * These are the three things a phone genuinely wants to differ on: which panels
 * are on and in what order, how big each one is, and whether the daily focus
 * field earns its space on a small screen.
 */
export const DEVICE_KEYS = ['layout', 'widget.sizes', 'today.showFocus'] as const;

/**
 * Keys shared by every device, as written by `useLocalStorage` (i.e. before the
 * per-user scope prefix is applied).
 *
 * An allowlist rather than "everything in localStorage", because two categories
 * of key must stay on the device entirely:
 *
 * - **`cache:*`** — cached weather and headlines. Public, refetchable, and
 *   large enough on its own to blow the metadata budget.
 * - **`gcal.syncToken`** — Google's incremental-sync cursor. It records what
 *   *this browser* has already seen; copying it to another device would make
 *   that device resume from a position it never reached and silently skip every
 *   event in between. Sync state is per-replica by definition.
 *
 * Spotify's OAuth token is absent for the same reason it lives in
 * `sessionStorage` (ADR 0006): credentials do not belong in synced storage.
 */
export const SHARED_KEYS = [
  'user.name',
  'theme',
  'focus',
  'reminders',
  'tasks.mergedTodos',
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
  // Whether the user has connected Gmail. That is the whole of the mail panel's
  // state worth syncing: ranking is computed from the inbox on each device
  // (ADR 0010), so there is nothing derived here to keep in step.
  'mail.connected',
] as const;

/** Every key this module moves, shared and per-device alike. */
export const SYNCED_KEYS: readonly string[] = [...SHARED_KEYS, ...DEVICE_KEYS];

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

/** One form factor's layout. */
export interface DeviceSlice {
  /** Raw stored JSON for {@link DEVICE_KEYS}. */
  data: Record<string, string>;
}

/** Everything the dashboard syncs, plus when it was last changed. */
export interface ProfileSnapshot {
  /** Bumped when the shape changes. v1 had no per-device split; see {@link readSnapshot}. */
  v: 2;
  /** Epoch ms of the most recent local change, used to settle conflicts. */
  updatedAt: number;
  /** Raw stored JSON for {@link SHARED_KEYS}, keyed by unscoped key. */
  data: Record<string, string>;
  /** Layouts, one per form factor that has ever saved one. */
  devices: Partial<Record<FormFactor, DeviceSlice>>;
}

/** Prefixes `key` with `scope`, matching `useLocalStorage`'s own scoping. */
function scoped(scope: string, key: string): string {
  return scope ? `${scope}:${key}` : key;
}

/** Reads the keys that are actually present, as raw stored JSON. */
function readKeys(scope: string, keys: readonly string[]): Record<string, string> {
  const data: Record<string, string> = {};
  for (const key of keys) {
    try {
      const raw = window.localStorage.getItem(scoped(scope, key));
      if (raw !== null) data[key] = raw;
    } catch {
      // Skip unreadable keys rather than abandoning the whole snapshot.
    }
  }
  return data;
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
 * Gathers this browser's synced keys into a snapshot, filing the layout under
 * `formFactor`.
 *
 * Only keys that are actually present are included, so a fresh account does not
 * publish a wall of defaults that would later win a conflict against a device
 * where the user had really set something.
 */
export function collect(scope: string, formFactor: FormFactor): ProfileSnapshot {
  return {
    v: 2,
    // Strictly the stamp, never a fallback to "now": a browser that has never
    // recorded a change must compare as *older* than the account. Dating it to
    // the present would make every fresh device look newer than the real
    // dashboard and push its emptiness over the top.
    updatedAt: localStamp(scope),
    data: readKeys(scope, SHARED_KEYS),
    devices: { [formFactor]: { data: readKeys(scope, DEVICE_KEYS) } },
  };
}

/**
 * Writes a snapshot's values into this browser's storage.
 *
 * A shared key the snapshot omits is *removed*: the snapshot is the account's
 * whole shared state, so a source deleted on another device has to disappear
 * here too rather than be resurrected on the next push.
 *
 * The layout is different. When the account holds no slice for this form factor
 * — the first phone to sign in to a desktop-only account — the local layout is
 * left exactly as it is, rather than being cleared to nothing. There is no
 * account copy to prefer, and wiping a layout the user already arranged, to
 * replace it with an absence, would be pure loss.
 */
export function apply(scope: string, snapshot: ProfileSnapshot, formFactor: FormFactor): void {
  const write = (keys: readonly string[], data: Record<string, string>) => {
    for (const key of keys) {
      const full = scoped(scope, key);
      try {
        const value = data[key];
        if (value === undefined) window.localStorage.removeItem(full);
        else window.localStorage.setItem(full, value);
      } catch {
        // Ignore individual failures; a partial apply still beats none.
      }
    }
  };

  write(SHARED_KEYS, snapshot.data);
  const slice = snapshot.devices?.[formFactor];
  if (slice) write(DEVICE_KEYS, slice.data);

  markLocal(scope, snapshot.updatedAt);
}

/**
 * Builds the snapshot to store, carrying every *other* device's layout through
 * untouched.
 *
 * This is what keeps the two syncs from overwriting each other: a phone pushing
 * its own arrangement must republish the desktop's slice verbatim, because the
 * account holds one metadata blob and a push replaces all of it.
 */
export function merge(local: ProfileSnapshot, remote: ProfileSnapshot | null): ProfileSnapshot {
  // `local.devices` holds exactly this form factor, so spreading it last keeps
  // ours authoritative and every other one as the account had it.
  return { ...local, devices: { ...remote?.devices, ...local.devices } };
}

/**
 * Parses whatever Clerk handed back, returning `null` for anything unusable.
 *
 * A v1 snapshot — written before layouts were split per device — is upgraded
 * rather than discarded: its layout keys become this device's slice, which is
 * the only form factor it could have been arranged on.
 */
export function readSnapshot(metadata: unknown, formFactor: FormFactor): ProfileSnapshot | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>)[METADATA_KEY];
  if (!raw || typeof raw !== 'object') return null;

  // Typed loosely on purpose: this is whatever a previous version of the app
  // wrote, so the version field has to be readable before it can be trusted.
  const snap = raw as { v?: number; updatedAt?: unknown; data?: unknown; devices?: unknown };
  if (typeof snap.updatedAt !== 'number' || !snap.data || typeof snap.data !== 'object') {
    return null;
  }
  const data = snap.data as Record<string, string>;

  if (snap.v === 1) {
    const shared: Record<string, string> = {};
    const layout: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if ((DEVICE_KEYS as readonly string[]).includes(key)) layout[key] = value;
      else shared[key] = value;
    }
    return { v: 2, updatedAt: snap.updatedAt, data: shared, devices: { [formFactor]: { data: layout } } };
  }

  if (snap.v !== 2) return null;
  return {
    v: 2,
    updatedAt: snap.updatedAt,
    data,
    devices: (snap.devices as ProfileSnapshot['devices']) ?? {},
  };
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
  const sizes: Record<string, number> = {};
  for (const [key, value] of Object.entries(snapshot.data)) sizes[key] = value.length;
  for (const slice of Object.values(snapshot.devices)) {
    for (const [key, value] of Object.entries(slice.data)) {
      sizes[key] = (sizes[key] ?? 0) + value.length;
    }
  }
  return Object.keys(sizes).sort((a, b) => sizes[b] - sizes[a]);
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
