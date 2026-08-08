import { describe, it, expect } from 'vitest';
import {
  mergeRemote,
  pendingPushes,
  fromEventStart,
  toEventTimes,
  type Reminder,
  type GEvent,
} from './gcalSync';

/** A fixed epoch, so merges are deterministic. */
const NOW = 1_700_000_000_000;

/** When the sample remote event was last touched on the server. */
const SERVER_EDIT = '2026-07-20T10:00:00Z';
/** A local edit made after {@link SERVER_EDIT}, so the local copy is the newer one. */
const LATER_LOCAL_EDIT = Date.parse('2026-07-21T00:00:00Z');

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return { id: 'r1', text: 'Task', due: '2026-07-25T09:00', done: false, ...overrides };
}

function event(overrides: Partial<GEvent> = {}): GEvent {
  return { id: 'e1', status: 'confirmed', summary: 'Task', updated: SERVER_EDIT, ...overrides };
}

describe('mergeRemote', () => {
  it('adds a brand-new remote event as a local reminder', () => {
    const merged = mergeRemote([], [event({ summary: 'Dentist' })], NOW);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ text: 'Dentist', eventId: 'e1', dirty: false, done: false });
  });

  it('overwrites a clean local reminder with the remote copy', () => {
    const local = [reminder({ eventId: 'e1', text: 'Old', dirty: false })];

    const merged = mergeRemote(local, [event({ summary: 'New' })], NOW);

    expect(merged[0].text).toBe('New');
    expect(merged[0].dirty).toBe(false);
  });

  it('keeps a dirty local reminder that is newer than the remote copy', () => {
    const local = [
      reminder({ eventId: 'e1', text: 'Local edit', dirty: true, updatedAt: LATER_LOCAL_EDIT }),
    ];

    const merged = mergeRemote(local, [event({ summary: 'Server' })], NOW);

    expect(merged[0].text).toBe('Local edit');
    expect(merged[0].dirty).toBe(true);
  });

  it('removes a local reminder whose event was cancelled remotely', () => {
    const local = [reminder({ eventId: 'e1', dirty: false })];

    const merged = mergeRemote(local, [event({ status: 'cancelled' })], NOW);

    expect(merged).toHaveLength(0);
  });

  it('keeps a dirty local reminder that is newer than a remote cancellation', () => {
    const local = [reminder({ eventId: 'e1', dirty: true, updatedAt: LATER_LOCAL_EDIT })];

    const merged = mergeRemote(
      local,
      [event({ status: 'cancelled', updated: '2026-07-20T00:00:00Z' })],
      NOW,
    );

    expect(merged).toHaveLength(1);
  });

  it('leaves a local-only reminder untouched, as the same object', () => {
    const localOnly = reminder({ id: 'local-only', eventId: undefined });

    const merged = mergeRemote([localOnly], [event({ summary: 'Other' })], NOW);

    expect(merged).toContain(localOnly);
  });
});

describe('pendingPushes', () => {
  it('inserts an event for a new dated reminder', () => {
    const { inserts, patches, deletes } = pendingPushes([
      reminder({ dirty: true, eventId: undefined }),
    ]);

    expect(inserts).toHaveLength(1);
    expect(patches).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });

  it('patches the event of a dirty reminder that is already synced', () => {
    const { patches } = pendingPushes([reminder({ dirty: true, eventId: 'e1' })]);

    expect(patches).toHaveLength(1);
  });

  it('deletes the event of a tombstoned reminder', () => {
    const { deletes } = pendingPushes([reminder({ eventId: 'e1', deleted: true })]);

    expect(deletes).toHaveLength(1);
  });

  it('deletes the event when a synced reminder loses its due date', () => {
    const { deletes } = pendingPushes([reminder({ eventId: 'e1', due: '', dirty: true })]);

    expect(deletes).toHaveLength(1);
  });

  it('pushes nothing when only the done flag was toggled', () => {
    const { inserts, patches, deletes } = pendingPushes([
      reminder({ eventId: 'e1', done: true, dirty: false }),
    ]);

    expect(inserts.length + patches.length + deletes.length).toBe(0);
  });

  it('pushes nothing for an undated reminder that was never synced', () => {
    const { inserts, patches, deletes } = pendingPushes([
      reminder({ due: '', eventId: undefined, dirty: true }),
    ]);

    expect(inserts.length + patches.length + deletes.length).toBe(0);
  });
});

describe('fromEventStart', () => {
  it('reads an all-day event date as a midnight datetime-local value', () => {
    expect(fromEventStart(event({ start: { date: '2026-07-25' } }))).toBe('2026-07-25T00:00');
  });
});

describe('toEventTimes', () => {
  it('gives a reminder event a 30-minute duration', () => {
    const { start, end } = toEventTimes('2026-07-25T09:00');

    const minutes = (Date.parse(end.dateTime) - Date.parse(start.dateTime)) / 60_000;
    expect(minutes).toBe(30);
  });
});
