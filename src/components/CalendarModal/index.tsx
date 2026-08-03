import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useMonthEvents } from '../../hooks/useMonthEvents';
import { useEventEditor } from '../../hooks/useEventEditor';
import EventForm from '../EventForm';
import { dayKey, localMidnight, type CalendarEvent } from '../../lib/gcalEvents';
import { DAYS_PER_WEEK, addMonths, weekdayLabels } from '../../lib/calendarGrid';
import styles from './styles.module.css';

/** Chips rendered in a day cell before the rest collapse into "+N more". */
const CHIPS_PER_CELL = 3;
/** 0 = Sunday. A setting one day, a constant today. */
const WEEK_STARTS_ON = 0;

/** "9:00" — the leading time on a timed chip. */
function shortTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * The time column in the detail panel, from the perspective of the day being
 * viewed: a multi-day event shows only the edge that falls on this day, and
 * reads as all-day on the days it covers completely.
 */
function timeRange(ev: CalendarEvent, onDay: string): string {
  if (ev.allDay) return 'All day';
  const starts = dayKey(ev.start) === onDay;
  const ends = dayKey(ev.end > ev.start ? ev.end - 1 : ev.start) === onDay;
  if (starts && ends) return `${shortTime(ev.start)} – ${shortTime(ev.end)}`;
  if (starts) return `${shortTime(ev.start)} – …`;
  if (ends) return `… – ${shortTime(ev.end)}`;
  return 'All day';
}

/** "Monday, 3 August" — the detail panel's heading. */
function dayHeading(key: string): string {
  return new Date(localMidnight(key)).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** Screen-reader label for a day cell: "Monday, 3 August 2026, 2 events". */
function cellLabel(key: string, count: number): string {
  const date = new Date(localMidnight(key)).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  if (count === 0) return `${date}, no events`;
  return `${date}, ${count} event${count === 1 ? '' : 's'}`;
}

/**
 * Passes a calendar's own colour to the stylesheet as a custom property.
 *
 * This project bans inline styles, and this is the one value that cannot live in
 * a stylesheet because Google supplies it at runtime. Every declaration stays in
 * CSS — only the colour itself crosses over.
 */
function eventColor(ev: CalendarEvent): CSSProperties | undefined {
  return ev.calendarColor ? ({ '--event-color': ev.calendarColor } as CSSProperties) : undefined;
}

/** Props for {@link CalendarModal}. */
interface CalendarModalProps {
  /** Current time, so "today" comes from the caller's ticking clock. */
  now: number;
  /** Called when the user dismisses the dialog. */
  onClose: () => void;
}

/**
 * Full month view of the user's Google Calendars, shown over the dashboard.
 *
 * Read-only, like the agenda widget that opens it: it reuses the token that
 * widget already holds and never writes to Google. It is mounted only while
 * open, so opening it is what triggers the first fetch.
 *
 * Rendered through a portal because the widget card it opens from is
 * transformed while being dragged, and a transformed ancestor would capture this
 * dialog's `position: fixed`.
 *
 * @param props - See {@link CalendarModalProps}.
 */
export default function CalendarModal({ now, onClose }: CalendarModalProps) {
  const cal = useMonthEvents(now, WEEK_STARTS_ON);
  const editor = useEventEditor(cal.calendars, now, cal.refresh);
  const canAdd = cal.calendars.some((c) => c.canWrite);
  const titleId = useId();
  const todayKey = dayKey(now);
  const weekdays = useMemo(() => weekdayLabels(WEEK_STARTS_ON), []);

  const dialogRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());

  /**
   * The day holding the grid's single tab stop (roving tabindex) — 42 tab stops
   * would make the dialog unusable from the keyboard. Tracked separately from
   * the selected day so arrowing around does not repaint the detail panel.
   */
  const [focusedDay, setFocusedDay] = useState(cal.selectedDay);
  /** Set by the key handlers, so only keyboard movement steals focus. */
  const viaKeyboard = useRef(false);

  const gridKeys = useMemo(() => new Set(cal.weeks.flat().map((c) => c.key)), [cal.weeks]);
  // Paging can leave the focused day off the grid; fall back so the grid never
  // ends up with no tab stop at all.
  const tabbableKey = gridKeys.has(focusedDay) ? focusedDay : cal.weeks[0][0].key;

  // Open: take focus and lock the page behind the dialog. Close: give both back.
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreTo?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!viaKeyboard.current) return;
    viaKeyboard.current = false;
    cellRefs.current.get(tabbableKey)?.focus();
  }, [tabbableKey]);

  /** Pages a month, optionally keeping focus on a given day in the new grid. */
  const pageMonth = useCallback(
    (delta: number, focusKey?: string) => {
      const target = addMonths(cal.year, cal.month, delta);
      if (delta < 0) cal.prev();
      else cal.next();
      setFocusedDay(focusKey ?? dayKey(new Date(target.year, target.month, 1).getTime()));
    },
    [cal],
  );

  /** Moves the grid's focus by whole days, paging the month at the edges. */
  const moveFocus = useCallback(
    (days: number) => {
      const d = new Date(localMidnight(focusedDay));
      d.setDate(d.getDate() + days);
      const key = dayKey(d.getTime());
      viaKeyboard.current = true;
      if (gridKeys.has(key)) setFocusedDay(key);
      else pageMonth(days < 0 ? -1 : 1, key);
    },
    [focusedDay, gridKeys, pageMonth],
  );

  const moveToWeekEdge = useCallback(
    (toEnd: boolean) => {
      const week = cal.weeks.find((w) => w.some((c) => c.key === focusedDay));
      if (!week) return;
      viaKeyboard.current = true;
      setFocusedDay(toEnd ? week[DAYS_PER_WEEK - 1].key : week[0].key);
    },
    [cal.weeks, focusedDay],
  );

  function onGridKeyDown(e: KeyboardEvent<HTMLTableSectionElement>) {
    const moves: Record<string, () => void> = {
      ArrowLeft: () => moveFocus(-1),
      ArrowRight: () => moveFocus(1),
      ArrowUp: () => moveFocus(-DAYS_PER_WEEK),
      ArrowDown: () => moveFocus(DAYS_PER_WEEK),
      Home: () => moveToWeekEdge(false),
      End: () => moveToWeekEdge(true),
      PageUp: () => pageMonth(-1),
      PageDown: () => pageMonth(1),
    };
    const move = moves[e.key];
    if (!move) return; // Enter and Space are the button's own business.
    e.preventDefault();
    move();
  }

  /** Keeps Tab inside the dialog while it is open. */
  function onDialogKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([tabindex="-1"]), a[href]',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function selectCell(key: string) {
    cal.selectDay(key);
    setFocusedDay(key);
    // Moving to another day dismisses an open form, the way clicking away from
    // a popup does in Google Calendar. The form occupies the panel that is
    // about to show a different day, so leaving it up would be a lie.
    if (key !== cal.selectedDay) editor.cancel();
  }

  function goToday() {
    cal.goToday();
    setFocusedDay(todayKey);
  }

  return createPortal(
    <div className={styles.container} onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <header>
          <h2 id={titleId}>{cal.title}</h2>
          <div className={styles.nav}>
            <button
              className={styles.step}
              onClick={() => pageMonth(-1)}
              aria-label="Previous month"
              title="Previous month"
            >
              ‹
            </button>
            <button className={styles.today} onClick={goToday}>
              Today
            </button>
            <button
              className={styles.step}
              onClick={() => pageMonth(1)}
              aria-label="Next month"
              title="Next month"
            >
              ›
            </button>
            <button
              className={styles.step}
              onClick={cal.refresh}
              disabled={cal.loading}
              aria-label="Refresh"
              title="Refresh"
            >
              ⟳
            </button>
            {cal.loading && (
              <span className={styles.loading} role="status">
                Loading…
              </span>
            )}
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Close calendar">
            ×
          </button>
        </header>

        {cal.error && (
          <p className={styles.error}>
            Couldn’t load your calendar: {cal.error}{' '}
            <button className={styles.retry} onClick={cal.refresh}>
              Retry
            </button>
          </p>
        )}

        <div className={styles.body}>
          <table className={styles.grid} role="grid" aria-labelledby={titleId}>
            <thead>
              <tr>
                {weekdays.map((w) => (
                  <th key={w.long} scope="col" abbr={w.long}>
                    {w.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody onKeyDown={onGridKeyDown}>
              {cal.weeks.map((week) => (
                <tr key={week[0].key}>
                  {week.map((cell) => {
                    const dayEvents = cal.byDay.get(cell.key) ?? [];
                    const shown = dayEvents.slice(0, CHIPS_PER_CELL);
                    const hidden = dayEvents.length - shown.length;
                    const selected = cell.key === cal.selectedDay;
                    const classes = [
                      styles.day,
                      !cell.inMonth && styles.isOutsideMonth,
                      cell.key === todayKey && styles.isToday,
                      selected && styles.isSelected,
                      cell.key < todayKey && styles.isPast,
                    ]
                      .filter(Boolean)
                      .join(' ');

                    return (
                      <td key={cell.key} aria-selected={selected}>
                        <button
                          ref={(el) => {
                            if (el) cellRefs.current.set(cell.key, el);
                            else cellRefs.current.delete(cell.key);
                          }}
                          className={classes}
                          tabIndex={cell.key === tabbableKey ? 0 : -1}
                          aria-current={cell.key === todayKey ? 'date' : undefined}
                          aria-label={cellLabel(cell.key, dayEvents.length)}
                          onClick={() => selectCell(cell.key)}
                        >
                          <span className={styles.num}>{cell.day}</span>
                          {shown.map((ev) => (
                            <span
                              key={`${ev.calendarId}:${ev.id}`}
                              className={`${styles.chip}${ev.allDay ? ` ${styles.isAllDay}` : ''}`}
                              style={eventColor(ev)}
                            >
                              {!ev.allDay && <b>{shortTime(ev.start)}</b>}
                              {ev.title}
                            </span>
                          ))}
                          {hidden > 0 && <span className={styles.more}>+{hidden} more</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <aside
            className={`${styles.detail}${editor.mode !== 'none' ? ` ${styles.isEditing}` : ''}`}
          >
            {editor.mode !== 'none' && editor.draft ? (
              <EventForm
                // Remounting is what loads a different event into the form,
                // which keeps the draft state in one place rather than syncing
                // props into state on every change.
                key={`${editor.mode}:${editor.target?.eventId ?? cal.selectedDay}`}
                draft={editor.draft}
                calendars={cal.calendars}
                editing={editor.mode === 'edit'}
                recurring={editor.recurring}
                saving={editor.saving}
                error={editor.error}
                onSave={editor.save}
                onDelete={editor.remove}
                onCancel={editor.cancel}
              />
            ) : (
              <>
                <div className={styles.detailHead}>
                  <h3>{dayHeading(cal.selectedDay)}</h3>
                  {canAdd && (
                    <button
                      className={styles.add}
                      onClick={() => editor.startNew(cal.selectedDay)}
                    >
                      + Add event
                    </button>
                  )}
                </div>

                {cal.selectedEvents.length === 0 ? (
                  <p className={styles.empty}>Nothing scheduled.</p>
                ) : (
                  <ul>
                    {cal.selectedEvents.map((ev) => (
                      <li key={`${ev.calendarId}:${ev.id}`} style={eventColor(ev)}>
                        <span className={styles.when}>{timeRange(ev, cal.selectedDay)}</span>
                        <span className={styles.what}>
                          {ev.htmlLink ? (
                            <a href={ev.htmlLink} target="_blank" rel="noreferrer">
                              {ev.title}
                            </a>
                          ) : (
                            ev.title
                          )}
                          {ev.location && <em>{ev.location}</em>}
                          {ev.calendarTitle && <small>{ev.calendarTitle}</small>}
                        </span>
                        {/* Absent for calendars the user can only read. */}
                        {ev.canWrite && (
                          <button
                            className={styles.edit}
                            onClick={() => editor.startEdit(ev)}
                            aria-label={`Edit ${ev.title}`}
                          >
                            Edit
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}
