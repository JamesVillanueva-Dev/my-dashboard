import { useId, useState, type FormEvent } from 'react';
import type { CalendarOption } from '../../lib/gcalEvents';
import type { EventDraft } from '../../lib/gcalWrite';
import styles from './styles.module.css';

/** Props for {@link EventForm}. */
interface EventFormProps {
  /** Starting values. Remount the form (via `key`) to load a different event. */
  draft: EventDraft;
  /** Calendars to offer; only writable ones are listed. */
  calendars: CalendarOption[];
  /** Editing an existing event rather than creating one — enables Delete. */
  editing: boolean;
  /** The event is one occurrence of a recurring series. */
  recurring: boolean;
  /** A write is in flight; the controls lock. */
  saving: boolean;
  /** Validation or API error to show, or '' for none. */
  error: string;
  onSave: (draft: EventDraft) => void;
  onDelete: () => void;
  onCancel: () => void;
}

/**
 * The create/edit form for a calendar event, shown in place of the month view's
 * day detail panel.
 *
 * It owns the working copy of the draft and hands the finished thing back on
 * submit; validation, the API call and the error text all belong to the caller,
 * so the same form serves creating and editing without knowing which is which.
 *
 * Deleting takes two clicks. It removes an event from the user's real calendar
 * and there is no undo, which is more than a single misplaced click should cost.
 *
 * @param props - See {@link EventFormProps}.
 */
export default function EventForm({
  draft,
  calendars,
  editing,
  recurring,
  saving,
  error,
  onSave,
  onDelete,
  onCancel,
}: EventFormProps) {
  const [d, setD] = useState(draft);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const id = useId();

  const writable = calendars.filter((c) => c.canWrite);
  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) =>
    setD((prev) => ({ ...prev, [key]: value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    onSave(d);
  }

  /**
   * Keeps the end from drifting behind the start when the start moves — the
   * common case is picking a date and expecting the event to follow.
   */
  function setStartDate(value: string) {
    setD((prev) => ({
      ...prev,
      startDate: value,
      endDate: prev.endDate < value ? value : prev.endDate,
    }));
  }

  return (
    <form className={styles.container} onSubmit={submit} noValidate>
      <h3>{editing ? 'Edit event' : 'New event'}</h3>

      <label htmlFor={`${id}-title`}>Title</label>
      {/* Autofocus is safe here: the form only renders in response to the user
          asking for it, and it already lives inside a focus-trapped dialog. */}
      <input
        id={`${id}-title`}
        type="text"
        value={d.title}
        onChange={(e) => set('title', e.target.value)}
        autoFocus
      />

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={d.allDay}
          onChange={(e) => set('allDay', e.target.checked)}
        />
        All day
      </label>

      <label htmlFor={`${id}-start`}>Starts</label>
      <div className={styles.row}>
        <input
          id={`${id}-start`}
          type="date"
          value={d.startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        {!d.allDay && (
          <input
            type="time"
            aria-label="Start time"
            value={d.startTime}
            onChange={(e) => set('startTime', e.target.value)}
          />
        )}
      </div>

      <label htmlFor={`${id}-end`}>Ends</label>
      <div className={styles.row}>
        <input
          id={`${id}-end`}
          type="date"
          value={d.endDate}
          onChange={(e) => set('endDate', e.target.value)}
        />
        {!d.allDay && (
          <input
            type="time"
            aria-label="End time"
            value={d.endTime}
            onChange={(e) => set('endTime', e.target.value)}
          />
        )}
      </div>

      <label htmlFor={`${id}-where`}>Where</label>
      <input
        id={`${id}-where`}
        type="text"
        value={d.location}
        onChange={(e) => set('location', e.target.value)}
      />

      <label htmlFor={`${id}-notes`}>Notes</label>
      <textarea
        id={`${id}-notes`}
        rows={2}
        value={d.description}
        onChange={(e) => set('description', e.target.value)}
      />

      <label htmlFor={`${id}-cal`}>Calendar</label>
      <select
        id={`${id}-cal`}
        value={d.calendarId}
        onChange={(e) => set('calendarId', e.target.value)}
      >
        {writable.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>

      {recurring && (
        <p className={styles.note}>
          This is one occurrence of a repeating event. Changes apply to this
          occurrence only.
        </p>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {confirmingDelete ? (
        <div className={styles.actions}>
          <span className={styles.prompt}>Delete this event?</span>
          <button type="button" className={styles.text} onClick={() => setConfirmingDelete(false)}>
            Keep
          </button>
          <button type="button" className={styles.danger} onClick={onDelete} disabled={saving}>
            {saving ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          {editing && (
            <button
              type="button"
              className={styles.text}
              onClick={() => setConfirmingDelete(true)}
              disabled={saving}
            >
              Delete
            </button>
          )}
          <button type="button" className={styles.text} onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className={styles.save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </form>
  );
}
