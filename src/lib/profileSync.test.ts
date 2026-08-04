import { describe, it, expect, beforeEach } from 'vitest';
import {
  BUDGET_BYTES,
  LOCAL_STAMP_KEY,
  METADATA_KEY,
  SYNCED_KEYS,
  apply,
  collect,
  localStamp,
  markLocal,
  measure,
  overBudget,
  readSnapshot,
  resolve,
  type ProfileSnapshot,
} from './profileSync';

const SCOPE = 'user_abc';
const at = (scope: string, key: string) => `${scope}:${key}`;

/** A snapshot with `data` filled in and a fixed stamp. */
const snap = (data: Record<string, string>, updatedAt = 1000): ProfileSnapshot => ({
  v: 1,
  updatedAt,
  data,
});

beforeEach(() => localStorage.clear());

describe('SYNCED_KEYS', () => {
  it('excludes the Google incremental-sync cursor', () => {
    // Copying this to a second device makes it resume from a position it never
    // reached, silently skipping every event in between.
    expect(SYNCED_KEYS).not.toContain('gcal.syncToken');
  });

  it('excludes credentials and the response cache', () => {
    for (const key of SYNCED_KEYS) {
      expect(key.startsWith('cache:')).toBe(false);
      expect(key).not.toBe('spotify.token');
      expect(key).not.toBe('spotify.pkce_verifier');
    }
  });

  it('carries the data a user actually authored', () => {
    for (const key of ['notes.text', 'reminders', 'quicklinks', 'youtube.sources', 'layout']) {
      expect(SYNCED_KEYS).toContain(key);
    }
  });
});

describe('collect', () => {
  it('gathers only the synced keys that are actually set', () => {
    localStorage.setItem(at(SCOPE, 'notes.text'), '"hello"');
    localStorage.setItem(at(SCOPE, 'cache:weather'), '{"big":true}');
    localStorage.setItem(at(SCOPE, 'gcal.syncToken'), '"tok"');

    const result = collect(SCOPE);

    expect(result.data['notes.text']).toBe('"hello"');
    expect(result.data['cache:weather']).toBeUndefined();
    expect(result.data['gcal.syncToken']).toBeUndefined();
    // Unset keys are absent rather than defaulted, so a fresh browser cannot
    // publish a wall of defaults that later beats a device with real data.
    expect(result.data['quicklinks']).toBeUndefined();
  });

  it('reads another account’s namespace as empty', () => {
    localStorage.setItem(at('user_other', 'notes.text'), '"theirs"');
    expect(collect(SCOPE).data['notes.text']).toBeUndefined();
  });

  it('dates a never-stamped browser as older than any account copy', () => {
    // The dangerous case: dating a fresh device to "now" would make it beat the
    // account on every comparison, and signing in on a new laptop would push an
    // empty dashboard over the real one.
    expect(collect(SCOPE).updatedAt).toBe(0);
    expect(resolve(collect(SCOPE), snap({ 'notes.text': '"real data"' }, 123))).toBe('pull');
  });
});

describe('apply', () => {
  it('writes the snapshot into this browser and stamps it', () => {
    apply(SCOPE, snap({ 'notes.text': '"from account"' }, 555));

    expect(localStorage.getItem(at(SCOPE, 'notes.text'))).toBe('"from account"');
    expect(localStamp(SCOPE)).toBe(555);
  });

  it('removes a key the account no longer has', () => {
    // Deleted on another device: it must not survive here and be pushed back.
    localStorage.setItem(at(SCOPE, 'youtube.sources'), '[{"id":"1"}]');

    apply(SCOPE, snap({ 'notes.text': '"kept"' }));

    expect(localStorage.getItem(at(SCOPE, 'youtube.sources'))).toBeNull();
  });

  it('leaves unsynced local keys alone', () => {
    localStorage.setItem(at(SCOPE, 'gcal.syncToken'), '"mine"');
    apply(SCOPE, snap({}));
    expect(localStorage.getItem(at(SCOPE, 'gcal.syncToken'))).toBe('"mine"');
  });
});

describe('readSnapshot', () => {
  it('reads a well-formed snapshot out of Clerk metadata', () => {
    const stored = { [METADATA_KEY]: snap({ 'notes.text': '"x"' }, 7) };
    expect(readSnapshot(stored)?.updatedAt).toBe(7);
  });

  it('rejects junk rather than handing widgets a broken shape', () => {
    expect(readSnapshot(null)).toBeNull();
    expect(readSnapshot({})).toBeNull();
    expect(readSnapshot({ [METADATA_KEY]: { v: 2, updatedAt: 1, data: {} } })).toBeNull();
    expect(readSnapshot({ [METADATA_KEY]: { v: 1, data: {} } })).toBeNull();
  });
});

describe('overBudget', () => {
  it('passes an ordinary dashboard', () => {
    expect(overBudget(snap({ 'notes.text': '"a short note"' }))).toEqual([]);
  });

  it('names the largest offender first when the cap is blown', () => {
    const huge = snap({
      'notes.text': JSON.stringify('x'.repeat(BUDGET_BYTES)),
      'user.name': '"me"',
    });

    const culprits = overBudget(huge);

    expect(culprits[0]).toBe('notes.text');
    expect(measure(huge)).toBeGreaterThan(BUDGET_BYTES);
  });
});

describe('resolve', () => {
  it('pulls when the account is newer than this browser', () => {
    expect(resolve(snap({}, 100), snap({}, 200))).toBe('pull');
  });

  it('pushes when this browser is newer', () => {
    expect(resolve(snap({}, 300), snap({}, 200))).toBe('push');
  });

  it('pushes a first-ever sync that has local data', () => {
    expect(resolve(snap({ 'notes.text': '"x"' }, 1), null)).toBe('push');
  });

  it('does nothing for a brand-new account with nothing anywhere', () => {
    expect(resolve(snap({}, 0), null)).toBe('idle');
  });

  it('does nothing when both sides are at the same revision', () => {
    expect(resolve(snap({}, 200), snap({}, 200))).toBe('idle');
  });
});

describe('markLocal / localStamp', () => {
  it('round-trips the change stamp', () => {
    markLocal(SCOPE, 4242);
    expect(localStamp(SCOPE)).toBe(4242);
    expect(localStorage.getItem(at(SCOPE, LOCAL_STAMP_KEY))).toBe('4242');
  });

  it('reads a missing or corrupt stamp as zero, so the account wins', () => {
    expect(localStamp(SCOPE)).toBe(0);
    localStorage.setItem(at(SCOPE, LOCAL_STAMP_KEY), 'not json');
    expect(localStamp(SCOPE)).toBe(0);
  });
});
