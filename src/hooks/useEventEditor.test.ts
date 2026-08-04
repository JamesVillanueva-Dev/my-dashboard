import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEventEditor } from './useEventEditor';
import { createEvent, deleteEvent, updateEvent } from '../lib/gcalWrite';
import type { EventDraft } from '../lib/gcalWrite';
import { toEvent, type CalendarEvent, type CalendarOption } from '../lib/gcalEvents';

// Only the three write calls are faked; the draft/validation helpers are the
// real ones, so what the form is allowed to submit is genuinely exercised.
vi.mock('../lib/gcalWrite', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/gcalWrite')>()),
  createEvent: vi.fn(() => Promise.resolve()),
  updateEvent: vi.fn(() => Promise.resolve()),
  deleteEvent: vi.fn(() => Promise.resolve()),
}));

const NOW = new Date(2026, 7, 3, 10, 15).getTime();

function calendar(over: Partial<CalendarOption> = {}): CalendarOption {
  return { id: 'cal-1', title: 'Work', primary: false, canWrite: true, ...over };
}

/** A calendar event as the read path produces one. */
function event(over: Record<string, unknown> = {}): CalendarEvent {
  const ev = toEvent(
    {
      id: 'e1',
      summary: 'Standup',
      start: { dateTime: new Date(2026, 7, 3, 9).toISOString() },
      end: { dateTime: new Date(2026, 7, 3, 10).toISOString() },
      ...over,
    },
    'cal-1',
    { canWrite: true },
  );
  if (!ev) throw new Error('fixture did not convert');
  return ev;
}

/** A valid draft the editor will accept. */
function draft(over: Partial<EventDraft> = {}): EventDraft {
  return {
    calendarId: 'cal-1',
    title: 'Standup',
    allDay: false,
    startDate: '2026-08-03',
    startTime: '09:00',
    endDate: '2026-08-03',
    endTime: '10:00',
    location: '',
    description: '',
    ...over,
  };
}

function setup(calendars: CalendarOption[] = [calendar()]) {
  const onChanged = vi.fn();
  const { result } = renderHook(() => useEventEditor(calendars, NOW, onChanged));
  return { result, onChanged };
}

beforeEach(() => {
  vi.mocked(createEvent).mockResolvedValue(undefined);
  vi.mocked(updateEvent).mockResolvedValue(undefined);
  vi.mocked(deleteEvent).mockResolvedValue(undefined);
});

describe('useEventEditor', () => {
  it('starts with no form open', () => {
    const { result } = setup();

    expect(result.current).toMatchObject({
      mode: 'none',
      draft: null,
      target: null,
      recurring: false,
      saving: false,
      error: '',
    });
  });

  describe('startNew', () => {
    it('opens a blank form on the chosen day', () => {
      const { result } = setup();

      act(() => result.current.startNew('2026-08-05'));

      expect(result.current.mode).toBe('new');
      expect(result.current.draft).toMatchObject({ title: '', startDate: '2026-08-05' });
      // Nothing to update — this is a create.
      expect(result.current.target).toBeNull();
    });

    it('defaults to the primary calendar', () => {
      const { result } = setup([
        calendar({ id: 'other' }),
        calendar({ id: 'mine', primary: true }),
      ]);

      act(() => result.current.startNew('2026-08-05'));

      expect(result.current.draft?.calendarId).toBe('mine');
    });

    it('falls back to the first writable calendar when none is primary', () => {
      const { result } = setup([
        calendar({ id: 'readonly', canWrite: false }),
        calendar({ id: 'writable' }),
      ]);

      act(() => result.current.startNew('2026-08-05'));

      expect(result.current.draft?.calendarId).toBe('writable');
    });

    it('leaves the calendar empty when nothing is writable', () => {
      const { result } = setup([calendar({ canWrite: false })]);

      act(() => result.current.startNew('2026-08-05'));

      expect(result.current.draft?.calendarId).toBe('');
    });
  });

  describe('startEdit', () => {
    it('loads the event into the form and remembers what to update', () => {
      const { result } = setup();

      act(() => result.current.startEdit(event()));

      expect(result.current.mode).toBe('edit');
      expect(result.current.draft).toMatchObject({ title: 'Standup', startDate: '2026-08-03' });
      expect(result.current.target).toEqual({ calendarId: 'cal-1', eventId: 'e1' });
    });

    it('flags one occurrence of a recurring series, so the form can say so', () => {
      const { result } = setup();

      act(() => result.current.startEdit(event({ recurringEventId: 'series-1' })));

      expect(result.current.recurring).toBe(true);
    });

    it('does not flag a one-off event as recurring', () => {
      const { result } = setup();

      act(() => result.current.startEdit(event()));

      expect(result.current.recurring).toBe(false);
    });
  });

  describe('cancel', () => {
    it('closes the form and discards the draft', () => {
      const { result } = setup();
      act(() => result.current.startEdit(event({ recurringEventId: 'series-1' })));

      act(() => result.current.cancel());

      expect(result.current).toMatchObject({
        mode: 'none',
        draft: null,
        target: null,
        recurring: false,
        error: '',
      });
    });
  });

  describe('save', () => {
    it('creates a new event, reloads the month, and closes', async () => {
      const { result, onChanged } = setup();
      act(() => result.current.startNew('2026-08-03'));

      await act(async () => result.current.save(draft()));

      expect(createEvent).toHaveBeenCalledWith(draft());
      expect(updateEvent).not.toHaveBeenCalled();
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(result.current.mode).toBe('none');
    });

    it('updates the event being edited rather than creating a second one', async () => {
      const { result, onChanged } = setup();
      act(() => result.current.startEdit(event()));

      await act(async () => result.current.save(draft({ title: 'Standup (moved)' })));

      expect(updateEvent).toHaveBeenCalledWith(
        { calendarId: 'cal-1', eventId: 'e1' },
        draft({ title: 'Standup (moved)' }),
      );
      expect(createEvent).not.toHaveBeenCalled();
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it('refuses an invalid draft without touching the network', async () => {
      const { result } = setup();
      act(() => result.current.startNew('2026-08-03'));

      await act(async () => result.current.save(draft({ title: '  ' })));

      expect(createEvent).not.toHaveBeenCalled();
      expect(result.current.error).toBe('Give the event a title.');
      // The form stays open on the user's input.
      expect(result.current.mode).toBe('new');
    });

    it('refuses a draft that ends before it starts', async () => {
      const { result } = setup();
      act(() => result.current.startNew('2026-08-03'));

      await act(async () => result.current.save(draft({ endTime: '08:00' })));

      expect(createEvent).not.toHaveBeenCalled();
      expect(result.current.error).toBe('The event must end after it starts.');
    });

    it('reports saving while the write is in flight', async () => {
      let finish!: () => void;
      vi.mocked(createEvent).mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      const { result } = setup();
      act(() => result.current.startNew('2026-08-03'));

      act(() => result.current.save(draft()));
      expect(result.current.saving).toBe(true);

      await act(async () => {
        finish();
      });
      expect(result.current.saving).toBe(false);
    });

    it('keeps the form open holding the input when the save fails', async () => {
      vi.mocked(createEvent).mockRejectedValue(Object.assign(new Error('nope'), { code: 403 }));
      const { result, onChanged } = setup();
      act(() => result.current.startNew('2026-08-03'));

      await act(async () => result.current.save(draft({ title: 'Precious' })));

      expect(result.current.mode).toBe('new');
      expect(result.current.saving).toBe(false);
      expect(result.current.error).toBe('You do not have permission to change that calendar.');
      // Nothing changed, so the month must not be reloaded.
      expect(onChanged).not.toHaveBeenCalled();
    });

    it('clears a previous error when a retry succeeds', async () => {
      vi.mocked(createEvent).mockRejectedValueOnce(new Error('flaky'));
      const { result } = setup();
      act(() => result.current.startNew('2026-08-03'));

      await act(async () => result.current.save(draft()));
      expect(result.current.error).toBe('flaky');

      await act(async () => result.current.save(draft()));

      await waitFor(() => expect(result.current.mode).toBe('none'));
      expect(result.current.error).toBe('');
    });
  });

  describe('remove', () => {
    it('deletes the event being edited, reloads, and closes', async () => {
      const { result, onChanged } = setup();
      act(() => result.current.startEdit(event()));

      await act(async () => result.current.remove());

      expect(deleteEvent).toHaveBeenCalledWith({ calendarId: 'cal-1', eventId: 'e1' });
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(result.current.mode).toBe('none');
    });

    it('does nothing when there is no event to delete', async () => {
      const { result } = setup();
      act(() => result.current.startNew('2026-08-03'));

      await act(async () => result.current.remove());

      expect(deleteEvent).not.toHaveBeenCalled();
      expect(result.current.mode).toBe('new');
    });

    it('keeps the form open and explains a failed delete', async () => {
      vi.mocked(deleteEvent).mockRejectedValue(Object.assign(new Error('gone'), { code: 404 }));
      const { result, onChanged } = setup();
      act(() => result.current.startEdit(event()));

      await act(async () => result.current.remove());

      expect(result.current.mode).toBe('edit');
      expect(result.current.error).toBe('That event no longer exists.');
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  it('sets no state after unmount', async () => {
    let finish!: () => void;
    vi.mocked(createEvent).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const onChanged = vi.fn();
    const { result, unmount } = renderHook(() => useEventEditor([calendar()], NOW, onChanged));
    act(() => result.current.startNew('2026-08-03'));
    act(() => result.current.save(draft()));

    unmount();
    await act(async () => {
      finish();
    });

    // The month view is gone; reloading it would be an update on a dead tree.
    expect(onChanged).not.toHaveBeenCalled();
  });
});
