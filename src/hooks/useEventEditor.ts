import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarEvent, CalendarOption } from '../lib/gcalEvents';
import {
  blankDraft,
  createEvent,
  deleteEvent,
  describeError,
  draftFromEvent,
  updateEvent,
  validateDraft,
  type EventDraft,
  type EventRef,
} from '../lib/gcalWrite';

/** Which form, if any, the month view is showing. */
export type EditorMode = 'none' | 'new' | 'edit';

/** What {@link useEventEditor} exposes to the month view. */
export interface EventEditor {
  /** Which form is open, if any; see {@link EditorMode}. */
  mode: EditorMode;
  /** The form's starting values; null when {@link mode} is `'none'`. */
  draft: EventDraft | null;
  /** The event being edited, when {@link mode} is `'edit'`. */
  target: EventRef | null;
  /** The target is one occurrence of a recurring series. */
  recurring: boolean;
  /** A write is in flight. */
  saving: boolean;
  /** Last write error, or '' if none. */
  error: string;
  /** Open a blank form for a day. */
  startNew: (day: string) => void;
  /** Open the form on an existing event. */
  startEdit: (ev: CalendarEvent) => void;
  /** Close the form, discarding the draft. */
  cancel: () => void;
  /** Create or update, then reload the month and close. */
  save: (draft: EventDraft) => void;
  /** Delete the event being edited, then reload the month and close. */
  remove: () => void;
}

/** The calendar a new event should default to: primary, else the first writable. */
function defaultCalendarId(calendars: CalendarOption[]): string {
  const writable = calendars.filter((c) => c.canWrite);
  return (writable.find((c) => c.primary) ?? writable[0])?.id ?? '';
}

/**
 * Owns the create/edit/delete flow for the month view.
 *
 * Every write here is the direct result of a user action in the form — nothing
 * polls, retries, or writes in the background — which is the containment that
 * survives now that the app writes to real calendars (see `gcalWrite.ts`).
 *
 * @param calendars - Calendars from the last load; supplies the default target.
 * @param now - Current time, for a new event's default start.
 * @param onChanged - Called after a successful write, to reload the month.
 */
export function useEventEditor(
  calendars: CalendarOption[],
  now: number,
  onChanged: () => void,
): EventEditor {
  const [mode, setMode] = useState<EditorMode>('none');
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [target, setTarget] = useState<EventRef | null>(null);
  const [recurring, setRecurring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const cancel = useCallback(() => {
    setMode('none');
    setDraft(null);
    setTarget(null);
    setRecurring(false);
    setError('');
  }, []);

  const startNew = useCallback(
    (day: string) => {
      setMode('new');
      setDraft(blankDraft(day, defaultCalendarId(calendars), now));
      setTarget(null);
      setRecurring(false);
      setError('');
    },
    [calendars, now],
  );

  const startEdit = useCallback((ev: CalendarEvent) => {
    setMode('edit');
    setDraft(draftFromEvent(ev));
    setTarget({ calendarId: ev.calendarId, eventId: ev.id });
    setRecurring(!!ev.recurringEventId);
    setError('');
  }, []);

  /** Runs one write, then reloads and closes. Shared by save and remove. */
  const run = useCallback(
    (write: () => Promise<void>) => {
      setSaving(true);
      setError('');
      write().then(
        () => {
          if (!aliveRef.current) return;
          setSaving(false);
          onChanged();
          cancel();
        },
        (e: unknown) => {
          if (!aliveRef.current) return;
          setSaving(false);
          // The form stays open holding the user's input — a failed save must
          // not cost them what they typed.
          setError(describeError(e));
        },
      );
    },
    [cancel, onChanged],
  );

  const save = useCallback(
    (next: EventDraft) => {
      const invalid = validateDraft(next);
      if (invalid) {
        setError(invalid);
        return;
      }
      run(() => (target ? updateEvent(target, next) : createEvent(next)));
    },
    [run, target],
  );

  const remove = useCallback(() => {
    if (!target) return;
    run(() => deleteEvent(target));
  }, [run, target]);

  return {
    mode,
    draft,
    target,
    recurring,
    saving,
    error,
    startNew,
    startEdit,
    cancel,
    save,
    remove,
  };
}
