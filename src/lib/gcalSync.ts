/**
 * Two-way sync between local reminders and a dedicated Google Calendar
 * ("Dashboard Reminders"), per ADR 0002.
 *
 * Design in brief:
 * - Only reminders with a due date sync; dateless reminders stay local.
 * - `done` is LOCAL ONLY and never touches Calendar.
 * - Sync is incremental via Calendar `syncToken`; a 410 triggers a full resync.
 * - Conflicts resolve last-write-wins: a locally `dirty` reminder edited more
 *   recently than the remote event wins, otherwise the remote event wins.
 *
 * The reconcile functions (`mergeRemote`, `pendingPushes`) are pure and take
 * `now` as a parameter so they can be unit-tested deterministically.
 */

import { getAccessToken } from './googleAuth';

/** A reminder, extended with the bookkeeping fields two-way sync needs. */
export interface Reminder {
  /** Local id (stable across syncs). */
  id: string;
  /** Reminder text ↔ event summary. */
  text: string;
  /** `datetime-local` value; '' means no date — the reminder stays local. */
  due: string;
  /** Completion — tracked locally only, never written to Calendar. */
  done: boolean;
  /** Linked Google event id, once the reminder has been pushed. */
  eventId?: string;
  /** Epoch ms of the last local edit to `text`/`due`. */
  updatedAt?: number;
  /** Epoch ms of the remote `event.updated` we last reconciled. */
  remoteUpdated?: number;
  /** Local edits to `text`/`due` awaiting push to Calendar. */
  dirty?: boolean;
  /** Tombstone: the linked event should be deleted, then this row dropped. */
  deleted?: boolean;
}

/** The subset of a Google Calendar event resource we read. */
export interface GEvent {
  id: string;
  status?: string; // 'confirmed' | 'cancelled' | ...
  summary?: string;
  updated?: string; // RFC3339
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

const API = 'https://www.googleapis.com/calendar/v3';
/** Title of the dedicated calendar we create and sync against. */
export const CALENDAR_SUMMARY = 'Dashboard Reminders';
/** Duration given to the event created for a reminder (minutes). */
const DEFAULT_DURATION_MIN = 30;
/** How far back to pull on the very first (tokenless) sync. */
const INITIAL_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// Pure mapping helpers
// ---------------------------------------------------------------------------

/** Formats a `Date` as a local-time `datetime-local` value (`YYYY-MM-DDTHH:mm`). */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

/** Builds start/end times for the event backing a reminder's due datetime. */
export function toEventTimes(due: string): {
  start: { dateTime: string };
  end: { dateTime: string };
} {
  const start = new Date(due);
  const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60_000);
  return { start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } };
}

/** Reads a `datetime-local` value from an event's start (timed or all-day). */
export function fromEventStart(ev: GEvent): string {
  const raw = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00` : '');
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : toLocalInput(d);
}

// ---------------------------------------------------------------------------
// Pure reconcile logic (unit-tested)
// ---------------------------------------------------------------------------

/**
 * Merges a batch of remote event changes into the local reminder list,
 * resolving conflicts last-write-wins. Returns a NEW array with NEW objects for
 * any changed rows (safe for React state); untouched rows keep their identity.
 *
 * @param local - Current local reminders.
 * @param events - Changed events from Calendar (may include `status: 'cancelled'`).
 * @param now - Epoch ms, used when an event lacks an `updated` timestamp.
 */
export function mergeRemote(local: Reminder[], events: GEvent[], now: number): Reminder[] {
  const byEvent = new Map(local.filter((r) => r.eventId).map((r) => [r.eventId as string, r]));
  const removed = new Set<string>(); // local ids to drop (remote deletions)
  const patched = new Map<string, Reminder>(); // local id -> replacement
  const added: Reminder[] = [];

  for (const ev of events) {
    const remoteUpdated = ev.updated ? Date.parse(ev.updated) : now;
    const existing = byEvent.get(ev.id);
    const localWins = !!existing && !!existing.dirty && (existing.updatedAt ?? 0) > remoteUpdated;

    if (ev.status === 'cancelled') {
      if (existing && !localWins) removed.add(existing.id);
      continue;
    }
    if (!existing) {
      added.push({
        id: `g-${ev.id}`,
        text: ev.summary ?? '(untitled)',
        due: fromEventStart(ev),
        done: false,
        eventId: ev.id,
        remoteUpdated,
        dirty: false,
      });
    } else if (!localWins) {
      patched.set(existing.id, {
        ...existing,
        text: ev.summary ?? existing.text,
        due: fromEventStart(ev),
        remoteUpdated,
        dirty: false,
      });
    }
  }

  const next = local
    .filter((r) => !removed.has(r.id))
    .map((r) => patched.get(r.id) ?? r);
  return [...next, ...added];
}

/** Push operations implied by the current local state. */
export interface PendingPushes {
  /** New, dated reminders with no event yet. */
  inserts: Reminder[];
  /** Dated reminders whose linked event needs updating. */
  patches: Reminder[];
  /** Reminders whose linked event must be deleted (tombstoned, or date cleared). */
  deletes: Reminder[];
}

/** Computes the push operations for a reconciled reminder list. */
export function pendingPushes(local: Reminder[]): PendingPushes {
  return {
    inserts: local.filter((r) => r.dirty && !r.eventId && !r.deleted && !!r.due),
    patches: local.filter((r) => r.dirty && !!r.eventId && !r.deleted && !!r.due),
    deletes: local.filter((r) => !!r.eventId && (r.deleted || (!r.due && !!r.dirty))),
  };
}

// ---------------------------------------------------------------------------
// Calendar REST calls
// ---------------------------------------------------------------------------

interface ApiError extends Error {
  code?: number;
}

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err: ApiError = new Error(`Calendar API error ${res.status}`);
    err.code = res.status;
    throw err;
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

/** Finds the "Dashboard Reminders" calendar, creating it if absent. */
export async function findOrCreateCalendar(token: string): Promise<string> {
  const list = await api<{ items?: { id: string; summary?: string }[] }>(
    token,
    '/users/me/calendarList',
  );
  const found = list.items?.find((c) => c.summary === CALENDAR_SUMMARY);
  if (found) return found.id;
  const created = await api<{ id: string }>(token, '/calendars', {
    method: 'POST',
    body: JSON.stringify({ summary: CALENDAR_SUMMARY }),
  });
  return created.id;
}

/** Result of an incremental list: events plus the next token, or a resync flag. */
export interface Changes {
  items: GEvent[];
  nextSyncToken?: string;
  needFullResync: boolean;
}

/**
 * Lists changed events. With a `syncToken` this returns only deltas; without
 * one it does an initial windowed pull. A 410 (token expired) surfaces as
 * `needFullResync` rather than throwing.
 */
export async function listChanges(
  token: string,
  calendarId: string,
  syncToken?: string,
): Promise<Changes> {
  const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
  const items: GEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  try {
    do {
      const params = new URLSearchParams({ singleEvents: 'true', maxResults: '250' });
      if (syncToken) {
        params.set('syncToken', syncToken);
        params.set('showDeleted', 'true');
      } else {
        params.set(
          'timeMin',
          new Date(Date.now() - INITIAL_WINDOW_DAYS * 86_400_000).toISOString(),
        );
      }
      if (pageToken) params.set('pageToken', pageToken);

      const page = await api<{
        items?: GEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      }>(token, `${base}?${params.toString()}`);

      items.push(...(page.items ?? []));
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
      pageToken = page.nextPageToken;
    } while (pageToken);

    return { items, nextSyncToken, needFullResync: false };
  } catch (e) {
    if ((e as ApiError).code === 410) return { items: [], needFullResync: true };
    throw e;
  }
}

async function insertEvent(
  token: string,
  calendarId: string,
  r: Reminder,
): Promise<{ id: string; updated: number }> {
  const ev = await api<GEvent>(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify({ summary: r.text, ...toEventTimes(r.due) }),
  });
  return { id: ev.id, updated: ev.updated ? Date.parse(ev.updated) : Date.now() };
}

async function patchEvent(
  token: string,
  calendarId: string,
  r: Reminder,
): Promise<{ updated: number }> {
  const ev = await api<GEvent>(
    token,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(r.eventId as string)}`,
    { method: 'PATCH', body: JSON.stringify({ summary: r.text, ...toEventTimes(r.due) }) },
  );
  return { updated: ev.updated ? Date.parse(ev.updated) : Date.now() };
}

async function deleteEvent(token: string, calendarId: string, eventId: string): Promise<void> {
  try {
    await api<null>(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' },
    );
  } catch (e) {
    // 404/410 means it's already gone — treat as success.
    const code = (e as ApiError).code;
    if (code !== 404 && code !== 410) throw e;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/** Inputs to {@link runSync}. */
export interface SyncInput {
  interactive: boolean;
  reminders: Reminder[];
  calendarId?: string;
  syncToken?: string;
  now: number;
}
/** Result of {@link runSync}: the new state to persist. */
export interface SyncResult {
  reminders: Reminder[];
  calendarId: string;
  syncToken?: string;
}

/**
 * Runs one full sync cycle: pull remote changes, merge, then push local
 * changes. Returns the reconciled reminders plus the calendar id and next sync
 * token to persist. Network/auth failures reject and leave state to the caller.
 */
export async function runSync(input: SyncInput): Promise<SyncResult> {
  const token = await getAccessToken(input.interactive);
  const calendarId = input.calendarId || (await findOrCreateCalendar(token));

  // 1) Pull — fall back to a tokenless full resync on 410.
  let changes = await listChanges(token, calendarId, input.syncToken);
  if (changes.needFullResync) changes = await listChanges(token, calendarId, undefined);
  const merged = mergeRemote(input.reminders, changes.items, input.now);
  const nextToken = changes.nextSyncToken ?? (changes.needFullResync ? undefined : input.syncToken);

  // 2) Push local changes, collecting per-row updates.
  const { inserts, patches, deletes } = pendingPushes(merged);
  const updates = new Map<string, Partial<Reminder>>();
  const drop = new Set<string>();

  for (const r of inserts) {
    const { id, updated } = await insertEvent(token, calendarId, r);
    updates.set(r.id, { eventId: id, remoteUpdated: updated, dirty: false });
  }
  for (const r of patches) {
    const { updated } = await patchEvent(token, calendarId, r);
    updates.set(r.id, { remoteUpdated: updated, dirty: false });
  }
  for (const r of deletes) {
    await deleteEvent(token, calendarId, r.eventId as string);
    if (r.deleted) drop.add(r.id);
    else updates.set(r.id, { eventId: undefined, dirty: false }); // date cleared → unlink
  }

  const reminders = merged
    .filter((r) => !drop.has(r.id))
    .map((r) => (updates.has(r.id) ? { ...r, ...updates.get(r.id) } : r));

  return { reminders, calendarId, syncToken: nextToken };
}
