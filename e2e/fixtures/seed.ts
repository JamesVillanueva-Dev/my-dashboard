import type { Page } from '@playwright/test';

/**
 * Seeding `localStorage` before the app boots.
 *
 * Every panel reads its state on first render, so a spec that navigates and
 * *then* writes storage has already tested the empty state. Both helpers here
 * install an init script instead, which runs before any page script on this and
 * every subsequent navigation — which is also what makes the reload specs work.
 */

/**
 * The keys the app owns, unscoped.
 *
 * Signed-in state namespaces these behind `<clerk-user-id>:` and the demo uses
 * `demo:`. Neither is reachable with auth switched off (see `playwright.config.ts`),
 * so the ordinary fixture only needs the bare forms — {@link seedRaw} is the way
 * to write a scoped key.
 */
export interface DashboardState {
  layout?: string[];
  'widget.sizes'?: Record<string, { cols: number; height: number | null }>;
  'today.showFocus'?: boolean;
  focus?: { date: string; text: string };
  theme?: string;
  'aura.follow'?: boolean;
  'user.name'?: string;
  greeting?: string;
  'notes.text'?: string;
  reminders?: { id: string; text: string; due: string; done: boolean }[];
  'tasks.mergedTodos'?: boolean;
  quicklinks?: { id: string; label: string; url: string }[];
  'news.feed'?: string;
  'news.sources'?: { id: string; label: string; url: string }[];
  'weather.unit'?: 'fahrenheit' | 'celsius';
  'weather.place'?: { name: string; latitude: number; longitude: number };
  'youtube.sources'?: unknown[];
  'youtube.current'?: string;
  'spotify.sources'?: unknown[];
  'spotify.current'?: string;
  'spotify.volume'?: number;
  'classes.courses'?: unknown[];
  'classes.current'?: string;
  'notify.tasks'?: boolean;
  'notify.sent'?: unknown;
  'mail.connected'?: boolean;
  'mail.dismissed'?: unknown[];
  'gcal.connected'?: boolean;
  'gcal.view.connected'?: boolean;
  'gcal.calendarId'?: string;
  'gcal.syncToken'?: string;
}

/**
 * Writes dashboard state before the app boots, JSON-encoded the way
 * `useLocalStorage` stores it.
 *
 * @param page - The page to seed. Call before `page.goto`.
 * @param state - Keys to write. Anything omitted keeps the app's own default.
 */
export async function seed(page: Page, state: DashboardState): Promise<void> {
  await seedRaw(
    page,
    Object.fromEntries(Object.entries(state).map(([key, value]) => [key, JSON.stringify(value)])),
  );
}

/**
 * Writes storage entries verbatim, with no JSON encoding.
 *
 * The way to seed something the app will have to survive rather than read: a
 * truncated array, a bare word where an object belongs, a key under a scope the
 * signed-out app cannot reach.
 *
 * **Only writes a key that is absent**, which matters more than it looks. An
 * init script runs on *every* navigation in the page's life, so a seed that
 * overwrote would quietly undo whatever the app persisted the moment a spec
 * reloaded — and a reload spec would then assert that the app remembers the
 * fixture rather than the change under test. First navigation finds empty
 * storage and seeds; every one after that finds the app's own values and leaves
 * them alone. `seedDemo` takes the same line, for the same reason.
 *
 * @param page - The page to seed. Call before `page.goto`.
 * @param entries - Fully-formed key/value pairs, exactly as they should land.
 */
export async function seedRaw(page: Page, entries: Record<string, string>): Promise<void> {
  await page.addInitScript((pairs: [string, string][]) => {
    for (const [key, value] of pairs) {
      if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, value);
    }
  }, Object.entries(entries));
}

/** Reads back what the app has persisted, for the reload and demo specs. */
export async function storedKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(window.localStorage).sort());
}

/**
 * Records what was in storage *before* the app ran, so a spec can check its
 * context really was fresh.
 *
 * Reading it after `goto` proves nothing: every panel persists its defaults on
 * mount, so a dashboard nobody has touched has already written two dozen keys by
 * the time a spec can look.
 *
 * @param page - The page to snapshot. Call before `page.goto`.
 * @returns A reader for the keys that existed at boot.
 */
export async function keysAtBoot(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    (window as unknown as { __keysAtBoot: string[] }).__keysAtBoot = Object.keys(
      window.localStorage,
    ).sort();
  });
  return () =>
    page.evaluate(() => (window as unknown as { __keysAtBoot: string[] }).__keysAtBoot ?? []);
}

/**
 * Reads and parses one persisted value.
 *
 * @returns The parsed value, or `undefined` when the key is absent or unparseable.
 */
export async function stored<T>(page: Page, key: string): Promise<T | undefined> {
  return page.evaluate((k) => {
    const raw = window.localStorage.getItem(k);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }, key);
}
