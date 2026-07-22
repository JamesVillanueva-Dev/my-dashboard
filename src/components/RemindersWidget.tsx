import { useState } from 'react';
import Widget from './Widget';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface Reminder {
  id: string;
  text: string;
  due: string; // ISO datetime-local value, may be ''
  done: boolean;
}

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
 * Timed reminders list persisted to localStorage. Each reminder has text, an
 * optional due date/time, and a done flag. Entries are sorted with incomplete
 * items first (soonest due first), then completed ones; overdue incomplete items
 * are visually highlighted.
 */
export default function RemindersWidget() {
  const [reminders, setReminders] = useLocalStorage<Reminder[]>('reminders', []);
  const [text, setText] = useState('');
  const [due, setDue] = useState('');

  const add = () => {
    if (!text.trim()) return;
    setReminders([
      ...reminders,
      { id: `${Date.now()}-${Math.round(performance.now())}`, text: text.trim(), due, done: false },
    ]);
    setText('');
    setDue('');
  };

  const toggle = (id: string) =>
    setReminders(reminders.map((r) => (r.id === id ? { ...r, done: !r.done } : r)));
  const remove = (id: string) => setReminders(reminders.filter((r) => r.id !== id));

  const sorted = [...reminders].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (!a.due) return 1;
    if (!b.due) return -1;
    return new Date(a.due).getTime() - new Date(b.due).getTime();
  });

  return (
    <Widget title="Reminders">
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
    </Widget>
  );
}
