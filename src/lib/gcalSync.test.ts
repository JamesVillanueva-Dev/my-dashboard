import { describe, it, expect } from 'vitest';
import {
  mergeRemote,
  pendingPushes,
  fromEventStart,
  toEventTimes,
  type Reminder,
  type GEvent,
} from './gcalSync';

const NOW = 1_700_000_000_000; // fixed epoch ms for determinism

function reminder(over: Partial<Reminder> = {}): Reminder {
  return { id: 'r1', text: 'Task', due: '2026-07-25T09:00', done: false, ...over };
}
function event(over: Partial<GEvent> = {}): GEvent {
  return { id: 'e1', status: 'confirmed', summary: 'Task', updated: '2026-07-20T10:00:00Z', ...over };
}

describe('mergeRemote', () => {
  it('adds a brand-new remote event as a local reminder', () => {
    const out = mergeRemote([], [event({ summary: 'Dentist' })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: 'Dentist', eventId: 'e1', dirty: false, done: false });
  });

  it('updates a non-dirty local reminder from the remote event (remote wins)', () => {
    const local = [reminder({ eventId: 'e1', text: 'Old', dirty: false })];
    const out = mergeRemote(local, [event({ summary: 'New' })], NOW);
    expect(out[0].text).toBe('New');
    expect(out[0].dirty).toBe(false);
  });

  it('keeps a locally-dirty reminder that is newer than the remote (local wins)', () => {
    const local = [
      reminder({ eventId: 'e1', text: 'Local edit', dirty: true, updatedAt: Date.parse('2026-07-21T00:00:00Z') }),
    ];
    const out = mergeRemote(local, [event({ summary: 'Server', updated: '2026-07-20T10:00:00Z' })], NOW);
    expect(out[0].text).toBe('Local edit');
    expect(out[0].dirty).toBe(true);
  });

  it('removes a local reminder when its event is cancelled remotely', () => {
    const local = [reminder({ eventId: 'e1', dirty: false })];
    const out = mergeRemote(local, [event({ status: 'cancelled' })], NOW);
    expect(out).toHaveLength(0);
  });

  it('does not remove a locally-dirty reminder newer than a remote cancellation', () => {
    const local = [
      reminder({ eventId: 'e1', dirty: true, updatedAt: Date.parse('2026-07-21T00:00:00Z') }),
    ];
    const out = mergeRemote(local, [event({ status: 'cancelled', updated: '2026-07-20T00:00:00Z' })], NOW);
    expect(out).toHaveLength(1);
  });

  it('leaves unrelated local reminders untouched (same identity)', () => {
    const keep = reminder({ id: 'local-only', eventId: undefined });
    const out = mergeRemote([keep], [event({ summary: 'Other' })], NOW);
    expect(out).toContain(keep); // same object reference preserved
  });
});

describe('pendingPushes', () => {
  it('inserts a new dated reminder with no event', () => {
    const { inserts, patches, deletes } = pendingPushes([reminder({ dirty: true, eventId: undefined })]);
    expect(inserts).toHaveLength(1);
    expect(patches).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });

  it('patches a dirty reminder that already has an event', () => {
    const { patches } = pendingPushes([reminder({ dirty: true, eventId: 'e1' })]);
    expect(patches).toHaveLength(1);
  });

  it('deletes an event for a tombstoned reminder', () => {
    const { deletes } = pendingPushes([reminder({ eventId: 'e1', deleted: true })]);
    expect(deletes).toHaveLength(1);
  });

  it('deletes the event when a synced reminder loses its due date', () => {
    const { deletes } = pendingPushes([reminder({ eventId: 'e1', due: '', dirty: true })]);
    expect(deletes).toHaveLength(1);
  });

  it('does nothing for a completion-only change (done toggled, not dirty)', () => {
    const { inserts, patches, deletes } = pendingPushes([
      reminder({ eventId: 'e1', done: true, dirty: false }),
    ]);
    expect(inserts.length + patches.length + deletes.length).toBe(0);
  });

  it('never pushes a dateless, unsynced reminder', () => {
    const { inserts, patches, deletes } = pendingPushes([
      reminder({ due: '', eventId: undefined, dirty: true }),
    ]);
    expect(inserts.length + patches.length + deletes.length).toBe(0);
  });
});

describe('event ⇄ due mapping', () => {
  it('reads an all-day event date into a datetime-local value', () => {
    expect(fromEventStart(event({ start: { date: '2026-07-25' } }))).toBe('2026-07-25T00:00');
  });

  it('gives a reminder event a 30-minute duration', () => {
    const { start, end } = toEventTimes('2026-07-25T09:00');
    const mins = (Date.parse(end.dateTime) - Date.parse(start.dateTime)) / 60_000;
    expect(mins).toBe(30);
  });
});
