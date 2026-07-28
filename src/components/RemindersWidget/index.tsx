import { useEffect, useRef, useState } from 'react';
import Widget from '../Widget';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useCalendarSync } from '../../hooks/useCalendarSync';
import type { Reminder } from '../../lib/gcalSync';
import styles from './styles.module.css';

/**
 * Formats a reminder's due date for display and flags whether it is in the past.
 *
 * @param due - ISO datetime-local string, or "" when no time was set.
 * @returns `{ label, overdue }` — a short "Mon 5, 3:00 PM"-style label (empty when
 *   no due date) and whether the due time is before now.
 */
function formatDue(due: string): { label: string; overdue: boolean } {
  if (!due) return { label: '', overdue: false };
  const d = new Date(due);
  const overdue = d.getTime() < Date.now();
  const label = d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return { label, overdue };
}

/**
 * Timed reminders list persisted to localStorage, optionally kept in two-way
 * sync with a dedicated "Dashboard Reminders" Google Calendar (see ADR 0002).
 *
 * Each reminder has text, an optional due date/time, and a done flag; entries
 * are sorted with incomplete items first (soonest due first), overdue items
 * highlighted. When connected to Google Calendar, reminders **with a due date**
 * become calendar events and remote changes flow back in; completion is tracked
 * locally only and never written to Calendar.
 */
export default function RemindersWidget() {
  const [reminders, setReminders] = useLocalStorage<Reminder[]>('reminders', []);
  const [text, setText] = useState('');
  const [due, setDue] = useState('');

  // Give the sync hook a live view of the reminders without stale closures.
  const remindersRef = useRef(reminders);
  useEffect(() => {
    remindersRef.current = reminders;
  }, [reminders]);
  const cal = useCalendarSync(() => remindersRef.current, setReminders);

  const add = () => {
    if (!text.trim()) return;
    const now = Date.now();
    setReminders([
      ...reminders,
      {
        id: `${now}-${Math.round(performance.now())}`,
        text: text.trim(),
        due,
        done: false,
        // Only dated reminders sync; mark them dirty so the next cycle pushes them.
        dirty: !!due,
        updatedAt: now,
      },
    ]);
    setText('');
    setDue('');
    if (cal.connected && due) cal.syncNow();
  };

  // Completion is local-only — never marks the reminder dirty for Calendar.
  const toggle = (id: string) =>
    setReminders(reminders.map((r) => (r.id === id ? { ...r, done: !r.done } : r)));

  const remove = (id: string) => {
    const target = reminders.find((r) => r.id === id);
    if (cal.connected && target?.eventId) {
      // Tombstone so the linked event gets deleted on the next sync.
      setReminders(
        reminders.map((r) =>
          r.id === id ? { ...r, deleted: true, dirty: true, updatedAt: Date.now() } : r,
        ),
      );
      cal.syncNow();
    } else {
      setReminders(reminders.filter((r) => r.id !== id));
    }
  };

  const visible = reminders.filter((r) => !r.deleted);
  const sorted = [...visible].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (!a.due) return 1;
    if (!b.due) return -1;
    return new Date(a.due).getTime() - new Date(b.due).getTime();
  });

  return (
    <Widget
      title="Reminders"
      className={styles.container}
      action={
        cal.configured ? (
          cal.connected ? (
            <span className={styles.cal}>
              <span className={styles.status} title="Synced with Google Calendar">
                {cal.syncing ? 'Syncing…' : '📅 Synced'}
              </span>
              <button
                className={styles.calBtn}
                onClick={cal.syncNow}
                disabled={cal.syncing}
                title="Sync now"
              >
                ⟳
              </button>
              <button
                className={styles.disconnect}
                onClick={cal.disconnect}
                title="Stop syncing"
              >
                Disconnect
              </button>
            </span>
          ) : (
            <button className={styles.calBtn} onClick={cal.connect} disabled={cal.syncing}>
              {cal.syncing ? 'Connecting…' : 'Connect Calendar'}
            </button>
          )
        ) : null
      }
    >
      <div className={styles.form}>
        <input
          type="text"
          placeholder="Remind me to…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className={styles.add} onClick={add}>
          Add
        </button>
      </div>

      {cal.configured && cal.connected && cal.error && (
        <p className={styles.error}>Calendar sync issue: {cal.error}</p>
      )}

      {sorted.length === 0 ? (
        <p>Nothing scheduled. Add a reminder above.</p>
      ) : (
        <ul className={styles.list}>
          {sorted.map((r) => {
            const { label, overdue } = formatDue(r.due);
            return (
              <li key={r.id} className={r.done ? styles.isDone : undefined}>
                <label>
                  <input type="checkbox" checked={r.done} onChange={() => toggle(r.id)} />
                  <span>{r.text}</span>
                </label>
                {r.eventId && (
                  <span className={styles.badge} title="Synced to Google Calendar">
                    📅
                  </span>
                )}
                {label && (
                  <span
                    className={`${styles.due}${overdue && !r.done ? ` ${styles.isOverdue}` : ''}`}
                  >
                    {label}
                  </span>
                )}
                <button onClick={() => remove(r.id)} title="Delete">
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!cal.configured && (
        <p className={styles.hint}>
          Want these on your Google Calendar? Add a <code>VITE_GOOGLE_CLIENT_ID</code> to{' '}
          <code>.env.local</code> (see ADR 0002) and a “Connect Calendar” button appears here.
        </p>
      )}
    </Widget>
  );
}
