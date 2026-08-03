import { useState, useEffect } from 'react';
import styles from './styles.module.css';

/**
 * Maps an hour-of-day (0–23) to a time-appropriate greeting.
 *
 * @param hour - Local hour, as returned by `Date.getHours()`.
 * @returns One of "Good night" | "Good morning" | "Good afternoon" | "Good evening".
 */
function greeting(hour: number): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Props for {@link Greeting}. */
interface GreetingProps {
  /** The user's display name (editable inline). */
  name: string;
  /** Called with the new name whenever the user edits it. */
  onNameChange: (name: string) => void;
}

/**
 * Page title beneath the nav bar: a time-of-day greeting with an inline-editable
 * name, and today's date.
 *
 * Unlike the clock in {@link Header}, nothing here changes second to second — the
 * greeting only turns over on an hour boundary and the date at midnight — so this
 * re-renders once a minute rather than once a second.
 *
 * @param props - See {@link GreetingProps}.
 */
export default function Greeting({ name, onNameChange }: GreetingProps) {
  const [now, setNow] = useState(new Date());
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const date = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className={styles.container}>
      <h1>
        {greeting(now.getHours())},{' '}
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => e.key === 'Enter' && setEditing(false)}
            placeholder="your name"
          />
        ) : (
          <button onClick={() => setEditing(true)} title="Click to edit your name">
            {name || 'friend'}
          </button>
        )}
      </h1>
      <p>{date}</p>
    </div>
  );
}
