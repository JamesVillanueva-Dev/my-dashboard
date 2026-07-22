import { useState, useEffect, type ReactNode } from 'react';
import ThemeToggle from './ThemeToggle';

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

/** Props for the {@link Header} component. */
interface HeaderProps {
  /** The user's display name (editable inline). */
  name: string;
  /** Called with the new name whenever the user edits it. */
  onNameChange: (name: string) => void;
  /** Extra controls rendered on the right, before the theme toggle (e.g. the widget menu). */
  actions?: ReactNode;
}

/**
 * Dashboard top bar: a live-updating greeting with editable name, the current
 * date, a ticking clock, and the light/dark theme toggle. The clock re-renders
 * once per second via an interval that is cleared on unmount.
 *
 * @param props - See {@link HeaderProps}.
 */
export default function Header({ name, onNameChange, actions }: HeaderProps) {
  const [now, setNow] = useState(new Date());
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  const date = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <header className="topbar">
      <div className="topbar__greeting">
        <h1>
          {greeting(now.getHours())},{' '}
          {editing ? (
            <input
              className="topbar__name-input"
              autoFocus
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => e.key === 'Enter' && setEditing(false)}
              placeholder="your name"
            />
          ) : (
            <button
              className="topbar__name"
              onClick={() => setEditing(true)}
              title="Click to edit your name"
            >
              {name || 'friend'}
            </button>
          )}
        </h1>
        <p className="topbar__date">{date}</p>
      </div>
      <div className="topbar__right">
        {actions}
        <ThemeToggle />
        <time className="topbar__clock" aria-label="Current time">
          {time}
        </time>
      </div>
    </header>
  );
}
