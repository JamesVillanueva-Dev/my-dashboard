import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BUDGET_BYTES,
  DEVICE_KEYS,
  LOCAL_STAMP_KEY,
  METADATA_KEY,
  SHARED_KEYS,
  SYNCED_KEYS,
  apply,
  collect,
  detectFormFactor,
  localStamp,
  markLocal,
  measure,
  merge,
  overBudget,
  readSnapshot,
  resolve,
  type ProfileSnapshot,
} from './profileSync';

const SCOPE = 'user_abc';

/** The keys holding content a user authored, which is shared across devices. */
const AUTHORED_KEYS = ['notes.text', 'reminders', 'quicklinks', 'youtube.sources'];

/** A scoped localStorage key, the way the dashboard stores it. */
const scopedKey = (scope: string, key: string) => `${scope}:${key}`;

/** The key under {@link SCOPE}, which is the scope nearly every case uses. */
const key = (name: string) => scopedKey(SCOPE, name);

/** A snapshot with shared `data` filled in and a fixed stamp. */
const snapshot = (
  data: Record<string, string>,
  updatedAt = 1000,
  devices: ProfileSnapshot['devices'] = {},
): ProfileSnapshot => ({ v: 2, updatedAt, data, devices });

beforeEach(() => localStorage.clear());

describe('SYNCED_KEYS', () => {
  it('excludes the Google incremental-sync cursor', () => {
    // Copying this to a second device makes it resume from a position it never
    // reached, silently skipping every event in between.
    expect(SYNCED_KEYS).not.toContain('gcal.syncToken');
  });

  it('excludes credentials and the response cache', () => {
    for (const syncedKey of SYNCED_KEYS) {
      expect(syncedKey.startsWith('cache:')).toBe(false);
      expect(syncedKey).not.toBe('spotify.token');
      expect(syncedKey).not.toBe('spotify.pkce_verifier');
    }
  });

  it('carries the data a user actually authored', () => {
    for (const authoredKey of [...AUTHORED_KEYS, 'layout']) {
      expect(SYNCED_KEYS).toContain(authoredKey);
    }
  });
});

describe('collect', () => {
  it('gathers the synced keys that are set', () => {
    localStorage.setItem(key('notes.text'), '"hello"');

    expect(collect(SCOPE, 'desktop').data['notes.text']).toBe('"hello"');
  });

  it('skips the keys that are not synced', () => {
    localStorage.setItem(key('cache:weather'), '{"big":true}');
    localStorage.setItem(key('gcal.syncToken'), '"tok"');

    const collected = collect(SCOPE, 'desktop');

    expect(collected.data['cache:weather']).toBeUndefined();
    expect(collected.data['gcal.syncToken']).toBeUndefined();
  });

  it('omits an unset key rather than publishing a default for it', () => {
    // A fresh browser must not publish a wall of defaults that later beats a
    // device holding real data.
    expect(collect(SCOPE, 'desktop').data['quicklinks']).toBeUndefined();
  });

  it('reads another account’s namespace as empty', () => {
    localStorage.setItem(scopedKey('user_other', 'notes.text'), '"theirs"');

    expect(collect(SCOPE, 'desktop').data['notes.text']).toBeUndefined();
  });

  it('dates a never-stamped browser to zero', () => {
    // The dangerous case: dating a fresh device to "now" would make it beat the
    // account on every comparison, and signing in on a new laptop would push an
    // empty dashboard over the real one.
    expect(collect(SCOPE, 'desktop').updatedAt).toBe(0);
  });

  it('loses to any account copy, however old', () => {
    const fresh = collect(SCOPE, 'desktop');

    expect(resolve(fresh, snapshot({ 'notes.text': '"real data"' }, 123))).toBe('pull');
  });
});

describe('apply', () => {
  it('writes the snapshot into this browser', () => {
    apply(SCOPE, snapshot({ 'notes.text': '"from account"' }, 555), 'desktop');

    expect(localStorage.getItem(key('notes.text'))).toBe('"from account"');
  });

  it('stamps this browser with the snapshot’s revision', () => {
    apply(SCOPE, snapshot({ 'notes.text': '"from account"' }, 555), 'desktop');

    expect(localStamp(SCOPE)).toBe(555);
  });

  it('removes a key the account no longer has', () => {
    // Deleted on another device: it must not survive here and be pushed back.
    localStorage.setItem(key('youtube.sources'), '[{"id":"1"}]');

    apply(SCOPE, snapshot({ 'notes.text': '"kept"' }), 'desktop');

    expect(localStorage.getItem(key('youtube.sources'))).toBeNull();
  });

  it('leaves unsynced local keys alone', () => {
    localStorage.setItem(key('gcal.syncToken'), '"mine"');

    apply(SCOPE, snapshot({}), 'desktop');

    expect(localStorage.getItem(key('gcal.syncToken'))).toBe('"mine"');
  });
});

describe('readSnapshot', () => {
  it('reads a well-formed snapshot out of Clerk metadata', () => {
    const stored = { [METADATA_KEY]: snapshot({ 'notes.text': '"x"' }, 7) };

    expect(readSnapshot(stored, 'desktop')?.updatedAt).toBe(7);
  });

  it('rejects metadata with no snapshot in it', () => {
    expect(readSnapshot(null, 'desktop')).toBeNull();
    expect(readSnapshot({}, 'desktop')).toBeNull();
  });

  it('rejects a snapshot from a future version', () => {
    const fromTheFuture = { [METADATA_KEY]: { v: 99, updatedAt: 1, data: {} } };

    expect(readSnapshot(fromTheFuture, 'desktop')).toBeNull();
  });

  it('rejects a snapshot with no stamp to compare on', () => {
    const unstamped = { [METADATA_KEY]: { v: 1, data: {} } };

    expect(readSnapshot(unstamped, 'desktop')).toBeNull();
  });

  it('upgrades a pre-split v1 snapshot into this device’s layout', () => {
    const v1 = {
      [METADATA_KEY]: {
        v: 1,
        updatedAt: 42,
        data: { 'notes.text': '"shared"', layout: '["notes"]' },
      },
    };

    const upgraded = readSnapshot(v1, 'desktop');

    // Content stays shared; the layout it was arranged with becomes this
    // device's, since that is the only form factor it could have come from.
    expect(upgraded?.data['notes.text']).toBe('"shared"');
    expect(upgraded?.data['layout']).toBeUndefined();
    expect(upgraded?.devices.desktop?.data['layout']).toBe('["notes"]');
  });
});

describe('the desktop/mobile split', () => {
  it('keeps the per-device keys out of the shared set', () => {
    for (const deviceKey of DEVICE_KEYS) {
      expect(SHARED_KEYS).not.toContain(deviceKey);
    }
  });

  it('keeps authored content shared rather than duplicated per device', () => {
    for (const authoredKey of AUTHORED_KEYS) {
      expect(SHARED_KEYS).toContain(authoredKey);
      expect(DEVICE_KEYS).not.toContain(authoredKey);
    }
  });

  it('files this browser’s layout under its own form factor', () => {
    localStorage.setItem(key('layout'), '["notes","weather"]');

    const collected = collect(SCOPE, 'mobile');

    expect(collected.devices.mobile?.data['layout']).toBe('["notes","weather"]');
    expect(collected.devices.desktop).toBeUndefined();
    expect(collected.data['layout']).toBeUndefined();
  });

  it('keeps shared content out of the device slice', () => {
    localStorage.setItem(key('notes.text'), '"shared"');

    const collected = collect(SCOPE, 'mobile');

    expect(collected.data['notes.text']).toBe('"shared"');
  });

  it('carries the other device’s layout through a push untouched', () => {
    const remote = snapshot({}, 100, { desktop: { data: { layout: '["a","b","c"]' } } });
    const localMobile = snapshot({}, 200, { mobile: { data: { layout: '["a"]' } } });

    const merged = merge(localMobile, remote);

    // The whole point: a phone saving its arrangement must not delete the PC's.
    expect(merged.devices.desktop?.data['layout']).toBe('["a","b","c"]');
    expect(merged.devices.mobile?.data['layout']).toBe('["a"]');
  });

  it('applies only this device’s layout, ignoring the other’s', () => {
    const bothDevices = snapshot({}, 1, {
      desktop: { data: { layout: '["desktop-order"]' } },
      mobile: { data: { layout: '["mobile-order"]' } },
    });

    apply(SCOPE, bothDevices, 'mobile');

    expect(localStorage.getItem(key('layout'))).toBe('["mobile-order"]');
  });

  it('leaves a layout alone when the account has none for this device yet', () => {
    // First phone signing in to a desktop-only account: there is no mobile slice
    // to prefer, and clearing the local one would replace it with an absence.
    localStorage.setItem(key('layout'), '["arranged-here"]');

    apply(SCOPE, snapshot({}, 1, { desktop: { data: { layout: '["pc"]' } } }), 'mobile');

    expect(localStorage.getItem(key('layout'))).toBe('["arranged-here"]');
  });
});

describe('detectFormFactor', () => {
  it('calls a device with a precise pointer a desktop', () => {
    expect(detectFormFactor()).toBe('desktop');
  });

  it('calls a device with a coarse pointer a mobile', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query.includes('coarse') }) as MediaQueryList,
    );

    expect(detectFormFactor()).toBe('mobile');
  });
});

describe('overBudget', () => {
  it('passes an ordinary dashboard', () => {
    expect(overBudget(snapshot({ 'notes.text': '"a short note"' }))).toEqual([]);
  });

  it('names the largest offender first when the cap is blown', () => {
    const huge = snapshot({
      'notes.text': JSON.stringify('x'.repeat(BUDGET_BYTES)),
      'user.name': '"me"',
    });

    expect(measure(huge)).toBeGreaterThan(BUDGET_BYTES);
    expect(overBudget(huge)[0]).toBe('notes.text');
  });
});

describe('resolve', () => {
  it('pulls when the account is newer than this browser', () => {
    expect(resolve(snapshot({}, 100), snapshot({}, 200))).toBe('pull');
  });

  it('pushes when this browser is newer', () => {
    expect(resolve(snapshot({}, 300), snapshot({}, 200))).toBe('push');
  });

  it('pushes a first-ever sync that has local data', () => {
    expect(resolve(snapshot({ 'notes.text': '"x"' }, 1), null)).toBe('push');
  });

  it('is idle for a brand-new account with nothing anywhere', () => {
    expect(resolve(snapshot({}, 0), null)).toBe('idle');
  });

  it('is idle when both sides are at the same revision', () => {
    expect(resolve(snapshot({}, 200), snapshot({}, 200))).toBe('idle');
  });
});

describe('markLocal and localStamp', () => {
  it('round-trips the change stamp', () => {
    markLocal(SCOPE, 4242);

    expect(localStamp(SCOPE)).toBe(4242);
    expect(localStorage.getItem(key(LOCAL_STAMP_KEY))).toBe('4242');
  });

  it('reads a missing stamp as zero, so the account wins', () => {
    expect(localStamp(SCOPE)).toBe(0);
  });

  it('reads a corrupt stamp as zero, so the account wins', () => {
    localStorage.setItem(key(LOCAL_STAMP_KEY), 'not json');

    expect(localStamp(SCOPE)).toBe(0);
  });
});
