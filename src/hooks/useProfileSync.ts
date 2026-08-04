import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  BUDGET_BYTES,
  LOCAL_STAMP_KEY,
  METADATA_KEY,
  SYNCED_KEYS,
  apply,
  collect,
  detectFormFactor,
  markLocal,
  measure,
  merge,
  overBudget,
  readSnapshot,
  resolve,
  type FormFactor,
  type ProfileSnapshot,
} from '../lib/profileSync';
import { onStorageWrite } from './useLocalStorage';

/** How long the dashboard must be idle before a change is pushed, in ms. */
const DEBOUNCE_MS = 1500;

/** What the sync is currently doing, for the UI to report. */
export type SyncStatus = 'off' | 'idle' | 'saving' | 'error';

/** The account-sync state a component can render. */
export interface ProfileSync {
  status: SyncStatus;
  /** Human-readable failure, or `null`. */
  error: string | null;
}

/** The subset of Clerk's user object this hook needs, so tests need not fake all of it. */
export interface SyncUser {
  id: string;
  unsafeMetadata: unknown;
  update: (params: { unsafeMetadata: Record<string, unknown> }) => Promise<unknown>;
}

/**
 * What this browser's synced state looks like, for "did anything really change?"
 * Covers the shared core and this device's layout, but not other devices' —
 * those are carried through untouched and can never be a local edit.
 */
function fingerprintOf(snapshot: ProfileSnapshot): string {
  return JSON.stringify([snapshot.data, snapshot.devices]);
}

/** Formats an over-budget snapshot into something a person can act on. */
function budgetMessage(snapshot: ProfileSnapshot, culprits: string[]): string {
  const kb = (n: number) => `${(n / 1024).toFixed(1)}KB`;
  return (
    `Your dashboard is ${kb(measure(snapshot))}, over the ${kb(BUDGET_BYTES)} your account ` +
    `can store — “${culprits[0]}” is the largest part. It is still saved in this browser, ` +
    `but it will not follow you to another device until it is smaller.`
  );
}

/**
 * Mirrors the dashboard's stored state onto the signed-in Clerk account.
 *
 * The pull happens **during render**, in a `useState` initializer, for the same
 * reason `adoptLegacyKeys` does: storage has to be correct before any widget
 * reads it. `useLocalStorage` persists on mount, so a widget rendered against an
 * un-hydrated namespace would write its default and the account's real data
 * would arrive to find itself already overwritten. Doing this in an effect would
 * be too late, and gating the whole dashboard behind a spinner to buy the same
 * guarantee would be a blank screen for no reason.
 *
 * The push is the opposite: it changes nothing locally, so it runs in the
 * background behind a mounted UI.
 *
 * Callers must mount this per account (`key={userId}`), so the initializer runs
 * again when the signed-in user changes.
 *
 * @param user - The signed-in Clerk user, or `null` when auth is off.
 */
export function useProfileSync(user: SyncUser | null): ProfileSync {
  const scope = user?.id ?? '';
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The synced data as the account last saw it.
   *
   * Guards against a page *load* being mistaken for an edit. Every widget writes
   * its current value on mount, and treating that as a change would bump this
   * browser's stamp on every visit — so merely opening the dashboard on a spare
   * laptop would outrank a phone with genuinely newer edits.
   */
  const lastSynced = useRef<string | null>(null);

  const push = useCallback(async (current: SyncUser, formFactor: FormFactor, baseline: string) => {
    const local = collect(current.id, formFactor);
    const fingerprint = fingerprintOf(local);
    // Nothing actually differs from what the account holds; don't touch the
    // stamp and don't spend a write.
    if (fingerprint === (lastSynced.current ?? baseline)) return;

    const at = Date.now();
    // Republish the other form factor's layout verbatim — the account holds one
    // blob, so a push that forgot it would delete the other device's arrangement.
    const remote = readSnapshot(current.unsafeMetadata, formFactor);
    const snapshot: ProfileSnapshot = { ...merge(local, remote), updatedAt: at };
    const culprits = overBudget(snapshot);
    if (culprits.length > 0) {
      setStatus('error');
      setError(budgetMessage(snapshot, culprits));
      return;
    }

    setStatus('saving');
    try {
      await current.update({ unsafeMetadata: { [METADATA_KEY]: snapshot } });
      markLocal(current.id, at);
      lastSynced.current = fingerprint;
      setStatus('idle');
      setError(null);
    } catch (e) {
      setStatus('error');
      setError(
        e instanceof Error
          ? `Couldn't save to your account: ${e.message}`
          : "Couldn't save to your account.",
      );
    }
  }, []);

  // Settle local against the account, before children render. See the note above
  // on why this is an initializer and not an effect.
  const [initial] = useState<{
    action: 'push' | 'pull' | 'idle';
    baseline: string;
    formFactor: FormFactor;
  }>(() => {
    const formFactor = detectFormFactor();
    if (!user) return { action: 'idle', baseline: '', formFactor };

    const local = collect(user.id, formFactor);
    const remote = readSnapshot(user.unsafeMetadata, formFactor);
    const action = resolve(local, remote);

    if (action === 'pull' && remote) apply(user.id, remote, formFactor);
    // A first-ever push still needs a stamp, or every later comparison ties.
    if (action === 'push' && !local.updatedAt) markLocal(user.id);

    // Whatever we settled on is the shared baseline, so the mount-time writes
    // that follow are correctly seen as "no change".
    return { action, baseline: fingerprintOf(collect(user.id, formFactor)), formFactor };
  });

  // This browser won, so the account needs catching up. Forced past the no-op
  // check, since the baseline is by definition what we are pushing.
  //
  // Queued rather than called straight from the effect: the push reports its
  // progress through state, and background work has no business re-rendering
  // the dashboard in the same commit that mounted it.
  useEffect(() => {
    if (!user || initial.action !== 'push') return;
    queueMicrotask(() => void push(user, initial.formFactor, ''));
  }, [user, initial, push]);

  // Steady state: a synced write schedules a push once the dashboard goes quiet.
  useEffect(() => {
    if (!user) return;
    const synced = new Set(SYNCED_KEYS.map((k) => `${scope}:${k}`));

    const unsubscribe = onStorageWrite((key) => {
      if (!synced.has(key)) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(
        () => void push(user, initial.formFactor, initial.baseline),
        DEBOUNCE_MS,
      );
    });

    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [user, scope, push, initial]);

  return user ? { status, error } : { status: 'off', error: null };
}

/**
 * Sync state published to the whole dashboard.
 *
 * Defaults to "off" so the signed-out and no-Clerk-key paths render without a
 * provider and behave exactly as they did before sync existed.
 */
const ProfileSyncContext = createContext<ProfileSync>({ status: 'off', error: null });

/** Publishes {@link useProfileSync}'s result to the dashboard below it. */
export const ProfileSyncProvider = ProfileSyncContext.Provider;

/** Reads the account-sync state, for components that report it to the user. */
export function useSyncStatus(): ProfileSync {
  return useContext(ProfileSyncContext);
}

/** Re-exported so callers can name the local stamp without reaching into the lib. */
export { LOCAL_STAMP_KEY };
