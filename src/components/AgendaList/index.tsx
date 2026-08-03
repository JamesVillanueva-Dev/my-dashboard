import Icon from '../Icon';
import { isInProgress, timeLabel, type AgendaItem } from '../../lib/agenda';
import styles from './styles.module.css';

/** Props for {@link AgendaList}. */
interface AgendaListProps {
  /** Items to render, already filtered and sorted by the caller. */
  items: AgendaItem[];
  /** Current time, for the in-progress highlight. */
  now: number;
  /** Ticks a task done. Events are never checkable, so they never call this. */
  onToggleTask: (id: string) => void;
  /** Shown when `items` is empty. */
  emptyLabel: string;
}

/**
 * The merged commitment list: calendar events and dated tasks in one timeline.
 *
 * Tasks render with a checkbox and write straight back to the shared task list,
 * so ticking something here updates the Tasks panel in the same render. Events
 * are read-only — the dashboard only ever reads real calendars (ADR 0002) — and
 * link out to Google Calendar instead.
 *
 * @param props - See {@link AgendaListProps}.
 */
export default function AgendaList({ items, now, onToggleTask, emptyLabel }: AgendaListProps) {
  if (items.length === 0) {
    return <p className={styles.empty}>{emptyLabel}</p>;
  }

  return (
    <ul className={styles.container}>
      {items.map((item) => {
        const live = isInProgress(item, now);
        const classes = [
          item.done ? styles.isDone : '',
          live ? styles.isLive : '',
          item.source === 'task' && !item.done && item.start < now ? styles.isOverdue : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <li key={item.key} className={classes || undefined}>
            <span className={styles.time}>{live ? 'Now' : timeLabel(item)}</span>

            {item.source === 'task' ? (
              <label>
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => onToggleTask(item.id)}
                />
                <span>{item.title}</span>
              </label>
            ) : (
              <span className={styles.event}>
                <Icon name="calendar" />
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.title}
                  </a>
                ) : (
                  <span>{item.title}</span>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
