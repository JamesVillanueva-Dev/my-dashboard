import { useCallback } from 'react';
import Widget from '../Widget';
import { useDashboardData } from '../../hooks/useDashboardData';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useCachedResource } from '../../hooks/useCachedResource';
import { fetchInbox, fetchKnownSenders, fetchProfileEmail } from '../../lib/gmail';
import { rankMail, type RankedMail } from '../../lib/importantMail';
import { buildBrief, type DayLoad } from '../../lib/morningBrief';
import styles from './styles.module.css';

/**
 * How long the brief's copy of the mail ranking stays fresh.
 *
 * Twelve hours, which is the panel's whole opinion about time: long enough that
 * the brief you read at breakfast is still the same brief at dinner, and short
 * enough that tomorrow morning is a new one. A brief that re-shuffled itself
 * every five minutes — the Mail panel's cadence, which is right for a panel you
 * watch — would not be a brief.
 *
 * Deliberately a TTL rather than a key with today's date in it. A day-stamped
 * key is a new cache slot every day and `lib/cache.ts` evicts nothing, so a year
 * of daily rankings would sit in `localStorage` forever. One slot, re-read when
 * it ages out.
 */
const TTL_MS = 12 * 60 * 60 * 1000;

/** Deep link to one message in the Gmail web client. */
const gmailUrl = (id: string) => `https://mail.google.com/mail/u/0/#inbox/${id}`;

/** The accent each classification carries. Set on the card, read by the tests. */
const LOAD_CLASS: Record<DayLoad, string> = {
  heavy: styles.isHeavy,
  normal: styles.isNormal,
  open: styles.isOpen,
};

/**
 * One paragraph of the day, composed in the browser from what the dashboard
 * already knows.
 *
 * The calendar half comes live from {@link useDashboardData} — the same merged
 * agenda the Today zone renders — and the mail half from the same ranking the
 * Mail panel shows, cached for {@link TTL_MS} so the brief holds still while you
 * read it. `lib/morningBrief.ts` turns the two into sentences; there is no model
 * behind the prose and nothing leaves the page (ADR 0001, ADR 0010).
 *
 * The two halves are cached differently on purpose. Mail is an async read, so it
 * is what {@link useCachedResource} holds; the calendar arrives through the
 * provider and the sentences are re-composed from it on every render. Freezing
 * the finished prose for the day was the other option and is worse: the loader
 * would run on mount, before the calendar had loaded, and pin "nothing on the
 * calendar" to a day that turned out to have six things in it.
 *
 * Mail is optional. When Gmail is not connected, or the read failed, the brief
 * is handed `null` rather than an empty ranking — the difference between "your
 * inbox holds nothing that needs you" and "your inbox was not looked at", only
 * one of which the panel is entitled to say.
 */
export default function MorningBriefWidget() {
  const { agenda, now, upcoming } = useDashboardData();
  // Read, never written: connecting Gmail is the Mail panel's business, and this
  // panel only asks whether that already happened.
  const [mailConnected] = useLocalStorage<boolean>('mail.connected', false);

  const load = useCallback(async (): Promise<RankedMail[] | null> => {
    // `useCachedResource` runs its loader on mount whatever its key says, so
    // this is what stops the brief reaching for mail nobody has connected.
    if (!mailConnected) return null;

    const [inbox, self] = await Promise.all([fetchInbox(false), fetchProfileEmail()]);
    const knownSenders = await fetchKnownSenders(inbox);
    return rankMail(inbox, { self, knownSenders }, Date.now());
  }, [mailConnected]);

  const mail = useCachedResource<RankedMail[] | null>(
    `brief:mail:${mailConnected ? 'on' : 'off'}`,
    TTL_MS,
    load,
  );

  // `data` is null while loading and when the read failed, which is exactly the
  // "not looked at" the brief wants — no separate signal needed.
  const brief = buildBrief(agenda, mail.data, now);

  const body = () => {
    // Without a calendar there is no day to classify, and a brief built from an
    // empty agenda would call an unknown day wide open. Said plainly rather than
    // offering a connect button: the Today zone above already owns that ask.
    if (upcoming.configured && !upcoming.connected) {
      return (
        <p className={styles.empty}>
          Your calendar isn’t connected yet, so there’s no day here to describe.
        </p>
      );
    }

    return (
      <>
        <p className={styles.headline}>{brief.headline}</p>

        {brief.shape.length > 0 && (
          <ul className={styles.shape}>
            {brief.shape.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        {brief.mail.length > 0 && (
          <section className={styles.mail}>
            <h3 id="brief-mail-heading">Worth a reply</h3>
            {/* An <ol>: the order is the ranking's, and the reason under each
                title is the ranking's own words for why it placed there. Named
                by the heading above it, so the list announces what it is rather
                than arriving as three bare links after a paragraph. */}
            <ol aria-labelledby="brief-mail-heading">
              {brief.mail.map((pick) => (
                <li key={pick.message.id}>
                  <a href={gmailUrl(pick.message.id)} target="_blank" rel="noreferrer">
                    {pick.message.subject || '(no subject)'}
                  </a>
                  <p>{pick.reason}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Only when there is no ranking at all to fall back on. A refresh that
            fails behind this morning's copy leaves the copy on screen, which is
            the right answer for a panel whose whole point is holding still. */}
        {mail.status === 'error' && (
          <p className={styles.note}>
            Couldn’t read your mail this morning.{' '}
            <button className={styles.link} onClick={mail.refresh}>
              Try again
            </button>
          </p>
        )}
      </>
    );
  };

  return (
    <Widget
      title="Morning Brief"
      icon="sun"
      className={`${styles.container} ${LOAD_CLASS[brief.load]}`}
    >
      {body()}
    </Widget>
  );
}
