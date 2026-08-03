import { useState, useEffect, type ReactNode } from 'react';
import ThemeToggle from '../ThemeToggle';
import UserMenu from '../UserMenu';
import styles from './styles.module.css';

/** Props for the {@link Header} component. */
interface HeaderProps {
  /** Extra controls rendered on the right, before the theme toggle (e.g. the widget menu). */
  actions?: ReactNode;
}

/**
 * Sticky nav bar across the top of the dashboard: a ticking clock on the left,
 * and the app controls (widget menu, theme toggle, user menu) on the right. The
 * clock re-renders once per second via an interval that is cleared on unmount.
 *
 * The bar spans the full viewport width rather than the dashboard's content
 * column, so it is rendered outside that column by {@link Dashboard}. The
 * greeting and date live below it in {@link Greeting}.
 *
 * @param props - See {@link HeaderProps}.
 */
export default function Header({ actions }: HeaderProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <header className={styles.container}>
      <time aria-label="Current time">{time}</time>
      <div>
        {actions}
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
