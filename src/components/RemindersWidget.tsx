import { useEffect, useRef, useState } from 'react';
import Widget from './Widget';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useCalendarSync } from '../hooks/useCalendarSync';
import type { Reminder } from '../lib/gcalSync';

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
      action={
        cal.configured ? (
          cal.connected ? (
            <span className="reminders__cal">
              <span className="muted small" title="Synced with Google Calendar">
                {cal.syncing ? 'Syncing…' : '📅 Synced'}
              </span>
              <button className="pill" onClick={cal.syncNow} disabled={cal.syncing} title="Sync now">
                ⟳
              </button>
              <button className="link small" onClick={cal.disconnect} title="Stop syncing">
                Disconnect
              </button>
            </span>
          ) : (
            <button className="pill" onClick={cal.connect} disabled={cal.syncing}>
              {cal.syncing ? 'Connecting…' : 'Connect Calendar'}
            </button>
          )
        ) : null
      }
    >
      <div className="reminder__form">
        <input
          type="text"
          placeholder="Remind me to…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="btn" onClick={add}>
          Add
        </button>
      </div>

      {cal.configured && cal.connected && cal.error && (
        <p className="muted small">Calendar sync issue: {cal.error}</p>
      )}

      {sorted.length === 0 ? (
        <p className="muted">Nothing scheduled. Add a reminder above.</p>
      ) : (
        <ul className="list">
          {sorted.map((r) => {
            const { label, overdue } = formatDue(r.due);
            return (
              <li key={r.id} className={r.done ? 'is-done' : ''}>
                <label>
                  <input type="checkbox" checked={r.done} onChange={() => toggle(r.id)} />
                  <span className="list__text">{r.text}</span>
                </label>
                {r.eventId && (
                  <span className="list__badge" title="Synced to Google Calendar">
                    📅
                  </span>
                )}
                {label && (
                  <span className={`list__due${overdue && !r.done ? ' is-overdue' : ''}`}>
                    {label}
                  </span>
                )}
                <button className="list__del" onClick={() => remove(r.id)} title="Delete">
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!cal.configured && (
        <p className="muted small reminders__hint">
          Want these on your Google Calendar? Add a <code>VITE_GOOGLE_CLIENT_ID</code> to{' '}
          <code>.env.local</code> (see ADR 0002) and a “Connect Calendar” button appears here.
        </p>
      )}
    </Widget>
  );
}
