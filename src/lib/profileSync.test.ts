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
const at = (scope: string, key: string) => `${scope}:${key}`;

/** A snapshot with shared `data` filled in and a fixed stamp. */
const snap = (
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

    const result = collect(SCOPE, 'desktop');

    expect(result.data['notes.text']).toBe('"hello"');
    expect(result.data['cache:weather']).toBeUndefined();
    expect(result.data['gcal.syncToken']).toBeUndefined();
    // Unset keys are absent rather than defaulted, so a fresh browser cannot
    // publish a wall of defaults that later beats a device with real data.
    expect(result.data['quicklinks']).toBeUndefined();
  });

  it('reads another account’s namespace as empty', () => {
    localStorage.setItem(at('user_other', 'notes.text'), '"theirs"');
    expect(collect(SCOPE, 'desktop').data['notes.text']).toBeUndefined();
  });

  it('dates a never-stamped browser as older than any account copy', () => {
    // The dangerous case: dating a fresh device to "now" would make it beat the
    // account on every comparison, and signing in on a new laptop would push an
    // empty dashboard over the real one.
    expect(collect(SCOPE, 'desktop').updatedAt).toBe(0);
    expect(resolve(collect(SCOPE, 'desktop'), snap({ 'notes.text': '"real data"' }, 123))).toBe('pull');
  });
});

describe('apply', () => {
  it('writes the snapshot into this browser and stamps it', () => {
    apply(SCOPE, snap({ 'notes.text': '"from account"' }, 555), 'desktop');

    expect(localStorage.getItem(at(SCOPE, 'notes.text'))).toBe('"from account"');
    expect(localStamp(SCOPE)).toBe(555);
  });

  it('removes a key the account no longer has', () => {
    // Deleted on another device: it must not survive here and be pushed back.
    localStorage.setItem(at(SCOPE, 'youtube.sources'), '[{"id":"1"}]');

    apply(SCOPE, snap({ 'notes.text': '"kept"' }), 'desktop');

    expect(localStorage.getItem(at(SCOPE, 'youtube.sources'))).toBeNull();
  });

  it('leaves unsynced local keys alone', () => {
    localStorage.setItem(at(SCOPE, 'gcal.syncToken'), '"mine"');
    apply(SCOPE, snap({}), 'desktop');
    expect(localStorage.getItem(at(SCOPE, 'gcal.syncToken'))).toBe('"mine"');
  });
});

describe('readSnapshot', () => {
  it('reads a well-formed snapshot out of Clerk metadata', () => {
    const stored = { [METADATA_KEY]: snap({ 'notes.text': '"x"' }, 7) };
    expect(readSnapshot(stored, 'desktop')?.updatedAt).toBe(7);
  });

  it('rejects junk rather than handing widgets a broken shape', () => {
    expect(readSnapshot(null, 'desktop')).toBeNull();
    expect(readSnapshot({}, 'desktop')).toBeNull();
    // A version from the future, and a snapshot with no stamp to compare on.
    expect(readSnapshot({ [METADATA_KEY]: { v: 99, updatedAt: 1, data: {} } }, 'desktop')).toBeNull();
    expect(readSnapshot({ [METADATA_KEY]: { v: 1, data: {} } }, 'desktop')).toBeNull();
  });

  it('upgrades a pre-split v1 snapshot into this device’s layout', () => {
    const v1 = {
      [METADATA_KEY]: {
        v: 1,
        updatedAt: 42,
        data: { 'notes.text': '"shared"', layout: '["notes"]' },
      },
    };

    const result = readSnapshot(v1, 'desktop');

    // Content stays shared; the layout it was arranged with becomes this
    // device's, since that is the only form factor it could have come from.
    expect(result?.data['notes.text']).toBe('"shared"');
    expect(result?.data['layout']).toBeUndefined();
    expect(result?.devices.desktop?.data['layout']).toBe('["notes"]');
  });
});

describe('the desktop/mobile split', () => {
  it('separates layout from content', () => {
    for (const key of DEVICE_KEYS) expect(SHARED_KEYS).not.toContain(key);
    // Content a user authored must never be duplicated per device.
    for (const key of ['notes.text', 'reminders', 'youtube.sources', 'quicklinks']) {
      expect(SHARED_KEYS).toContain(key);
      expect(DEVICE_KEYS).not.toContain(key);
    }
  });

  it('files this browser’s layout under its own form factor', () => {
    localStorage.setItem(at(SCOPE, 'layout'), '["notes","weather"]');
    localStorage.setItem(at(SCOPE, 'notes.text'), '"shared"');

    const mobile = collect(SCOPE, 'mobile');

    expect(mobile.devices.mobile?.data['layout']).toBe('["notes","weather"]');
    expect(mobile.devices.desktop).toBeUndefined();
    expect(mobile.data['notes.text']).toBe('"shared"');
    expect(mobile.data['layout']).toBeUndefined();
  });

  it('carries the other device’s layout through a push untouched', () => {
    const remote = snap({}, 100, { desktop: { data: { layout: '["a","b","c"]' } } });
    const localMobile = snap({}, 200, { mobile: { data: { layout: '["a"]' } } });

    const merged = merge(localMobile, remote);

    // The whole point: a phone saving its arrangement must not delete the PC's.
    expect(merged.devices.desktop?.data['layout']).toBe('["a","b","c"]');
    expect(merged.devices.mobile?.data['layout']).toBe('["a"]');
  });

  it('applies only this device’s layout, ignoring the other’s', () => {
    apply(
      SCOPE,
      snap({}, 1, {
        desktop: { data: { layout: '["desktop-order"]' } },
        mobile: { data: { layout: '["mobile-order"]' } },
      }),
      'mobile',
    );

    expect(localStorage.getItem(at(SCOPE, 'layout'))).toBe('["mobile-order"]');
  });

  it('leaves a layout alone when the account has none for this device yet', () => {
    // First phone signing in to a desktop-only account: there is no mobile slice
    // to prefer, and clearing the local one would replace it with an absence.
    localStorage.setItem(at(SCOPE, 'layout'), '["arranged-here"]');

    apply(SCOPE, snap({}, 1, { desktop: { data: { layout: '["pc"]' } } }), 'mobile');

    expect(localStorage.getItem(at(SCOPE, 'layout'))).toBe('["arranged-here"]');
  });

  it('calls a coarse pointer mobile and everything else desktop', () => {
    expect(detectFormFactor()).toBe('desktop');

    const coarse = (query: string) => ({ matches: query.includes('coarse') }) as MediaQueryList;
    vi.spyOn(window, 'matchMedia').mockImplementation(coarse);
    expect(detectFormFactor()).toBe('mobile');
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
