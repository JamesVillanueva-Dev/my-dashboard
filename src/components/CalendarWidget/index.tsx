import { useState } from 'react';
import Widget from '../Widget';
import Icon from '../Icon';
import CalendarModal from '../CalendarModal';
import { useDashboardData } from '../../hooks/useDashboardData';
import { groupByDay, WINDOW_DAYS, type CalendarEvent } from '../../lib/gcalEvents';
import styles from './styles.module.css';

/**
 * Formats an event's time column: "All day", "in progress", or a start time.
 *
 * @param ev - The event to label.
 * @param now - Current time, so "Now" is decided by the caller's clock.
 */
function timeLabel(ev: CalendarEvent, now: number): string {
  if (ev.allDay) return 'All day';
  if (ev.start <= now && now < ev.end) return 'Now';
  return new Date(ev.start).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Read-only agenda of the next {@link WINDOW_DAYS} days from the user's own
 * Google Calendars, grouped by day (plan Phase 2).
 *
 * Distinct from the Calendar sync in Reminders: that pushes reminders out to a
 * dedicated app-created calendar, while this reads across every calendar the
 * user has selected in Google Calendar and never writes. Events the user has
 * declined are filtered out; in-progress events are marked "Now".
 *
 * The header's expand button opens {@link CalendarModal}, a full month grid over
 * the dashboard. That view fetches its own months on the token this widget
 * already holds, which is why it is only offered once connected.
 */
export default function CalendarWidget() {
  // Shared with the Today zone via the provider. Calling `useUpcomingEvents`
  // here as well would mean a second access-token request and a second poll.
  const { upcoming: cal } = useDashboardData();
  const days = groupByDay(cal.events, cal.now);
  const [monthOpen, setMonthOpen] = useState(false);

  return (
    <Widget
      title="Calendar"
      icon="calendar"
      className={styles.container}
      action={
        cal.configured ? (
          cal.connected ? (
            <span className={styles.controls}>
              <button
                className={styles.iconBtn}
                onClick={() => setMonthOpen(true)}
                title="Open full calendar"
                aria-label="Open full calendar"
              >
                <Icon name="expand" />
              </button>
              <button
                className={styles.iconBtn}
                onClick={cal.refresh}
                disabled={cal.loading}
                title="Refresh"
                aria-label="Refresh"
              >
                <Icon name="refresh" />
              </button>
              <button className={styles.disconnect} onClick={cal.disconnect} title="Stop showing">
                Disconnect
              </button>
            </span>
          ) : (
            <button className={styles.connect} onClick={cal.connect} disabled={cal.loading}>
              {cal.loading ? 'Connecting…' : 'Connect Google'}
            </button>
          )
        ) : null
      }
    >
      {!cal.configured ? (
        <p className={styles.hint}>
          To see your calendar here, add a <code>VITE_GOOGLE_CLIENT_ID</code> to{' '}
          <code>.env.local</code> and restart the dev server.
        </p>
      ) : cal.error ? (
        <p className={styles.error}>
          Couldn’t load your calendar: {cal.error}{' '}
          <button className={styles.retry} onClick={cal.connect}>
            Retry
          </button>
        </p>
      ) : !cal.connected ? (
        <p className={styles.hint}>
          Connect your Google account to see what’s coming up over the next {WINDOW_DAYS} days.
        </p>
      ) : days.length === 0 ? (
        <p className={styles.empty}>
          {cal.loading ? 'Loading…' : `Nothing scheduled in the next ${WINDOW_DAYS} days.`}
        </p>
      ) : (
        <div className={styles.agenda}>
          {days.map((day) => (
            <section key={day.key}>
              <h3>{day.label}</h3>
              <ul>
                {day.events.map((ev) => {
                  const label = timeLabel(ev, cal.now);
                  const past = !ev.allDay && ev.end <= cal.now;
                  return (
                    <li
                      key={`${ev.calendarId}:${ev.id}`}
                      className={past ? styles.isPast : undefined}
                    >
                      <span
                        className={`${styles.time}${label === 'Now' ? ` ${styles.isNow}` : ''}`}
                      >
                        {label}
                      </span>
                      <span className={styles.dot} aria-hidden="true" />
                      <span className={styles.title}>
                        {ev.htmlLink ? (
                          <a href={ev.htmlLink} target="_blank" rel="noreferrer">
                            {ev.title}
                          </a>
                        ) : (
                          ev.title
                        )}
                        {ev.location && <em>{ev.location}</em>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Also gated on `connected`, so disconnecting while the month view is
          open closes it rather than leaving a dialog with no data behind it. */}
      {monthOpen && cal.connected && (
        <CalendarModal now={cal.now} onClose={() => setMonthOpen(false)} />
      )}
    </Widget>
  );
}
