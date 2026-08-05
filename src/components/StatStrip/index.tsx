import type { AgendaCounts } from '../../lib/agenda';
import styles from './styles.module.css';

/** Props for {@link StatStrip}. */
interface StatStripProps {
  /** Aggregate figures from `countAgenda`. */
  counts: AgendaCounts;
}

/** One figure, plus whether a non-zero value is a problem worth colouring. */
interface Stat {
  /** Stable React key. */
  key: string;
  /** The word after the number ("overdue", "left"); written for a plural. */
  label: string;
  /** The count. Zero drops the stat from the strip entirely. */
  value: number;
  /** Colour this one when it is non-zero — reserved for things that are late. */
  urgent?: boolean;
}

/**
 * The aggregate readout in the Today zone: how much is left, how much is late,
 * how many events remain.
 *
 * Zero-valued stats are dropped rather than rendered as "0", so the strip stays a
 * list of things needing attention instead of a wall of noughts. When every
 * figure is zero it collapses to a single all-clear line.
 *
 * @param props - See {@link StatStripProps}.
 */
export default function StatStrip({ counts }: StatStripProps) {
  const stats: Stat[] = [
    { key: 'overdue', label: 'overdue', value: counts.overdue, urgent: true },
    {
      key: 'remaining',
      label: counts.remainingToday === 1 ? 'task left' : 'tasks left',
      value: counts.remainingToday,
    },
    {
      key: 'events',
      label: counts.eventsLeft === 1 ? 'event left' : 'events left',
      value: counts.eventsLeft,
    },
    { key: 'undated', label: 'undated', value: counts.undated },
  ].filter((stat) => stat.value > 0);

  if (stats.length === 0) {
    return <p className={styles.clear}>Nothing left today.</p>;
  }

  return (
    <ul className={styles.container}>
      {stats.map((stat) => (
        <li key={stat.key} className={stat.urgent ? styles.isUrgent : undefined}>
          <strong>{stat.value}</strong>
          <span>{stat.label}</span>
        </li>
      ))}
    </ul>
  );
}
