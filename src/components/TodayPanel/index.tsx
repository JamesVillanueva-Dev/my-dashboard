import { useState } from 'react';
import AgendaList from '../AgendaList';
import StatStrip from '../StatStrip';
import Icon from '../Icon';
import { useDashboardData } from '../../hooks/useDashboardData';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { nextUp, relativeLabel, timeLabel, todayItems } from '../../lib/agenda';
import styles from './styles.module.css';

/**
 * @returns Today's date as a stable `YYYY-MM-DD` key in **local** time, used to
 *   reset the focus field when the calendar day changes.
 */
function todayKey(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Props for {@link TodayPanel}. */
interface TodayPanelProps {
  /**
   * Whether to show the daily focus field. Turned off from the widget menu, for
   * people who do not want to be asked to set an intention every morning.
   */
  showFocus?: boolean;
}

/**
 * The lead zone: the one part of the dashboard that answers "what now?".
 *
 * Pulls the merged agenda from {@link useDashboardData} — calendar events and
 * dated tasks in a single timeline — and surfaces what is happening next, the
 * day's one stated intention, and the aggregate counts. Ticking a task here
 * writes through to the shared list, so the Tasks panel updates in the same
 * render.
 *
 * Unlike a widget this is not draggable or removable: it is the frame the rest
 * of the dashboard hangs off, not one more panel competing for attention.
 */
export default function TodayPanel({ showFocus = true }: TodayPanelProps) {
  const { agenda, counts, now, toggleTask, upcoming } = useDashboardData();
  // The fallback carries no date on purpose: reading the clock during render is
  // impure, and an empty date simply reads as "no focus set for today".
  const [focus, setFocus] = useLocalStorage<{ date: string; text: string }>('focus', {
    date: '',
    text: '',
  });

  const key = todayKey(now);
  // The stored focus expires with the day it was written for.
  const focusText = focus.date === key ? focus.text : '';
  const [editing, setEditing] = useState(false);

  /**
   * Nothing set, and nobody typing — so the field asks for nothing.
   *
   * This is the state the zone is in most of the time, and it used to be an
   * empty text box sitting in the best space on the page, waiting. Every other
   * element here earns its place by showing you something; this one only ever
   * demanded something, and it emptied itself again every morning. Collapsed to
   * an offer, it costs nothing on the days you ignore it.
   */
  const idle = !editing && !focusText;

  const today = todayItems(agenda, now);
  const next = nextUp(agenda, now);

  const classes = [styles.container, !showFocus && styles.isFocusOff, idle && styles.isFocusIdle]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={classes} aria-labelledby="today-heading">
      <div className={styles.lead}>
        <div className={styles.next}>
          {/* Kept in the DOM but not on screen: it names the section for
              `aria-labelledby` and keeps the "Today" heading below it from
              skipping a level. The headline underneath says what it is. */}
          <h2 id="today-heading" className={styles.srOnly}>
            Next up
          </h2>
          {next ? (
            <>
              <p className={styles.title}>{next.title}</p>
              <p className={styles.when}>
                <span>{relativeLabel(next, now)}</span>
                <span aria-hidden="true">·</span>
                <span>{timeLabel(next)}</span>
              </p>
            </>
          ) : upcoming.configured && !upcoming.connected ? (
            // The prompt *is* the control: with nothing scheduled there is
            // nothing else on this row to click, so the sentence carries the
            // action rather than sitting above a separate button.
            <p className={styles.title}>
              <button
                className={styles.connect}
                onClick={upcoming.connect}
                disabled={upcoming.loading}
              >
                Connect your calendar
              </button>{' '}
              to see what’s coming.
            </p>
          ) : (
            <p className={styles.title}>Nothing scheduled.</p>
          )}
          <StatStrip counts={counts} />
        </div>

        {showFocus && (
          <div className={styles.focus}>
            {idle ? (
              <button className={styles.prompt} onClick={() => setEditing(true)}>
                <Icon name="target" /> Set a focus
              </button>
            ) : editing ? (
              <>
                <label className={styles.legend} htmlFor="today-focus">
                  <Icon name="target" /> Today, my one focus is…
                </label>
                <input
                  id="today-focus"
                  // Mounted by the click that asked for it, so taking focus is
                  // finishing that gesture rather than stealing the caret.
                  autoFocus
                  value={focusText}
                  // Still written through on every keystroke, as before: closing
                  // the tab mid-sentence should not lose the sentence.
                  onChange={(e) => setFocus({ date: key, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') setEditing(false);
                  }}
                  onBlur={() => setEditing(false)}
                  placeholder="Set your intention"
                />
              </>
            ) : (
              <>
                <span className={styles.legend}>
                  <Icon name="target" /> Today, my one focus is…
                </span>
                {/* Reads as the statement it is; only admits to being a control
                    on hover. */}
                <button
                  className={styles.set}
                  onClick={() => setEditing(true)}
                  aria-label={`Edit today’s focus: ${focusText}`}
                >
                  {focusText}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className={styles.agenda}>
        <h3>Today</h3>
        <AgendaList
          items={today}
          now={now}
          onToggleTask={toggleTask}
          emptyLabel="Nothing on today. Add a task below, or connect your calendar."
        />
      </div>
    </section>
  );
}
