import { useState } from 'react';
import Widget from '../Widget';
import Icon from '../Icon';
import { useDashboardData } from '../../hooks/useDashboardData';
import { sortTasks } from '../../lib/tasks';
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
 * The dashboard's single task list, optionally kept in two-way sync with a
 * dedicated "Dashboard Reminders" Google Calendar (see ADR 0002).
 *
 * Each task has text, an **optional** due date/time, and a done flag. A dated
 * task becomes a calendar event and remote changes flow back in; an undated one
 * stays purely local — which is exactly what the retired To-do widget was, and
 * why the two panels were merged into this one. Completion is tracked locally
 * only and never written to Calendar.
 *
 * State lives in {@link useDashboardData} rather than here, so the Today zone
 * reads and writes the same list instead of a diverging copy.
 */
export default function RemindersWidget() {
  const { tasks, setTasks, toggleTask, cal } = useDashboardData();
  const [text, setText] = useState('');
  const [due, setDue] = useState('');

  const add = () => {
    if (!text.trim()) return;
    const now = Date.now();
    setTasks((prev) => [
      ...prev,
      {
        id: `${now}-${Math.round(performance.now())}`,
        text: text.trim(),
        due,
        done: false,
        // Only dated tasks sync; mark them dirty so the next cycle pushes them.
        dirty: !!due,
        updatedAt: now,
      },
    ]);
    setText('');
    setDue('');
    if (cal.connected && due) cal.syncNow();
  };

  const remove = (id: string) => {
    const target = tasks.find((t) => t.id === id);
    if (cal.connected && target?.eventId) {
      // Tombstone so the linked event gets deleted on the next sync.
      setTasks((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, deleted: true, dirty: true, updatedAt: Date.now() } : t,
        ),
      );
      cal.syncNow();
    } else {
      setTasks((prev) => prev.filter((t) => t.id !== id));
    }
  };

  const sorted = sortTasks(tasks.filter((t) => !t.deleted));
  const remaining = sorted.filter((t) => !t.done).length;

  return (
    <Widget
      title="Tasks"
      icon="checkSquare"
      className={styles.container}
      action={
        /* Only two things live here — a count and, at most, one icon button.
           The old header also carried a "Synced" label and a "Disconnect" link,
           which collided with the title at narrow column widths; the connection
           controls moved to the footer below, where they have room. */
        <span className={styles.headerActions}>
          <span className={styles.count}>{remaining} left</span>
          {cal.configured && cal.connected && (
            <button
              className={styles.calBtn}
              onClick={cal.syncNow}
              disabled={cal.syncing}
              title={cal.syncing ? 'Syncing…' : 'Synced with Google Calendar — sync now'}
              aria-label="Sync with Google Calendar now"
            >
              <Icon name="refresh" />
            </button>
          )}
        </span>
      }
    >
      <div className={styles.form}>
        <input
          type="text"
          placeholder="Add a task…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <input
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="Due date (optional)"
        />
        <button className={styles.add} onClick={add}>
          Add
        </button>
      </div>

      {cal.configured && cal.connected && cal.error && (
        <p className={styles.error}>Calendar sync issue: {cal.error}</p>
      )}

      {sorted.length === 0 ? (
        <p>No tasks yet. Add one above — a due date is optional.</p>
      ) : (
        <ul className={styles.list}>
          {sorted.map((r) => {
            const { label, overdue } = formatDue(r.due);
            return (
              <li key={r.id} className={r.done ? styles.isDone : undefined}>
                <label>
                  <input type="checkbox" checked={r.done} onChange={() => toggleTask(r.id)} />
                  <span>{r.text}</span>
                </label>
                {r.eventId && (
                  <span className={styles.badge} title="Synced to Google Calendar">
                    <Icon name="calendarCheck" label="Synced to Google Calendar" />
                  </span>
                )}
                {label && (
                  <span
                    className={`${styles.due}${overdue && !r.done ? ` ${styles.isOverdue}` : ''}`}
                  >
                    {label}
                  </span>
                )}
                <button onClick={() => remove(r.id)} title="Delete" aria-label={`Delete ${r.text}`}>
                  <Icon name="close" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Connection controls live here rather than in the header, which has no
          room for them once the panel is in a narrow column. */}
      {cal.configured && (
        <p className={styles.sync}>
          {cal.connected ? (
            <>
              <Icon name="calendarCheck" />
              <span>{cal.syncing ? 'Syncing with Google Calendar…' : 'Dated tasks sync to Google Calendar'}</span>
              <button className={styles.disconnect} onClick={cal.disconnect} title="Stop syncing">
                Disconnect
              </button>
            </>
          ) : (
            <button className={styles.calBtn} onClick={cal.connect} disabled={cal.syncing}>
              {cal.syncing ? 'Connecting…' : 'Connect Calendar'}
            </button>
          )}
        </p>
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
