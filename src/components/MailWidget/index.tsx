import { useCallback, useEffect, useState } from 'react';
import Widget from '../Widget';
import Icon from '../Icon';
import { useWidgetExpanded } from '../WidgetModal/expanded';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useCachedResource } from '../../hooks/useCachedResource';
import { hasGoogleClientId } from '../../lib/googleAuth';
import { fetchInbox, fetchKnownSenders, fetchProfileEmail, senderName } from '../../lib/gmail';
import { FLOOR, notable, rankMail, TOP_N, type RankedMail } from '../../lib/importantMail';
import styles from './styles.module.css';

/**
 * How long a ranking stays fresh.
 *
 * Short, because a refresh is now free: scoring happens in this browser, so the
 * only cost is a Gmail read. (It was fifteen minutes when every refresh was a
 * paid model call — that constraint is gone with ADR 0010.) Five minutes keeps
 * the panel close to the inbox without hammering the API on a dashboard left
 * open on a second monitor.
 */
const TTL_MS = 5 * 60 * 1000;

/**
 * How many picks the full-screen view shows, against {@link TOP_N} in the card.
 *
 * The card's three is a constraint — a dashboard tile has room for three rows of
 * mail and no more. Full screen has the room, and the ranking almost always runs
 * deeper than three, so showing only three there wastes the click. Ten is where
 * the ordering stops being an argument: past it the scores are close enough
 * together that the panel is no longer telling you anything you could not get by
 * opening Gmail, which is one scroll away in every row.
 *
 * Filled from the whole ranking, not only from what cleared {@link FLOOR}: a
 * quiet week often has two or three messages that genuinely deserve the word
 * important, and a full-screen view holding two rows and a lot of empty space is
 * the wrong answer to a deliberate click. The rows past the floor are dimmed and
 * say what they are, so the depth costs nothing in honesty — see {@link Picks}.
 */
const EXPANDED_N = 10;

/** Deep link to one message in the Gmail web client. */
const gmailUrl = (id: string) => `https://mail.google.com/mail/u/0/#inbox/${id}`;

/**
 * Age of a message, at the width a mail row can spare: `now`, `12m`, `3h`, `2d`.
 *
 * Nothing longer is needed — candidates are capped at a week old (`gmail.ts`) —
 * and nothing longer would fit beside the sender without pushing on it.
 */
function timeAgo(at: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** First letter of the sender, for the avatar disc. `?` when nothing parses. */
function initial(sender: string): string {
  return sender.match(/[a-z0-9]/i)?.[0].toUpperCase() ?? '?';
}

/**
 * The full arithmetic behind one pick, for the `title` tooltip.
 *
 * This is the advantage a local heuristic has over asking a model: when the
 * panel picks something odd, the reason is inspectable rather than inscrutable.
 */
function breakdown({ score, signals }: RankedMail): string {
  const parts = signals.map((s) =>
    s.factor === 1 ? `${s.key} ${s.points >= 0 ? '+' : ''}${s.points}` : `${s.key} ×${s.factor.toFixed(2)}`,
  );
  return `score ${score} — ${parts.join(', ')}`;
}

/** Props for {@link Picks}. */
interface PicksProps {
  /** Every message still wanted, best first — deeper than either window shows. */
  kept: RankedMail[];
  /** Hides one message from the panel. */
  onDismiss: (id: string) => void;
}

/**
 * The picks themselves: a window onto the ranking, sized to the room there is.
 *
 * The two sizes differ in depth *and* in standard. The card shows at most
 * {@link TOP_N}, and only messages that cleared {@link FLOOR} — a tile with three
 * rows has no business spending one on mail that did not earn it. Full screen
 * fills {@link EXPANDED_N} from the whole ranking, so the click is worth making
 * on a quiet week; the rows below the floor come last, dimmed, under a line
 * saying that is what they are. Nothing is claimed to be important that isn't —
 * the extra rows are visibly the remainder of the inbox, in ranked order.
 *
 * Windowing lives here rather than in {@link MailWidget} for the same reason it
 * does in {@link Dismissed} — only a component *inside* the widget body can read
 * {@link useWidgetExpanded}; `MailWidget` builds that body and sits above the
 * provider, so it would always read `false`.
 *
 * It takes the whole kept ranking rather than a pre-cut list, because the cut is
 * the one thing that differs between the two sizes.
 *
 * @param props - See {@link PicksProps}.
 */
function Picks({ kept, onDismiss }: PicksProps) {
  const expanded = useWidgetExpanded();
  const picks = expanded ? kept.slice(0, EXPANDED_N) : notable(kept).slice(0, TOP_N);

  // Only reachable in the card, since `MailWidget` renders this at all only when
  // something is left: an inbox with mail in it, none of which cleared the bar.
  // Worth saying where the rest went — the click that shows it is right there.
  if (picks.length === 0) {
    return (
      <p className={styles.empty}>
        Nothing in the last week needs you. Open it full screen for the rest of your inbox.
      </p>
    );
  }

  return (
    <ol className={styles.list}>
      {picks.map((pick) => {
        const { message } = pick;
        const sender = senderName(message.from);
        const classes = [
          message.unread && styles.isUnread,
          // Below the floor: here to fill the window, not because it matters.
          pick.merit < FLOOR && styles.isMinor,
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <li key={message.id} className={classes || undefined} title={breakdown(pick)}>
            <span className={styles.avatar} aria-hidden="true">
              {initial(sender)}
            </span>
            <div>
              <header>
                <span>{sender}</span>
                <time dateTime={new Date(message.receivedAt).toISOString()}>
                  {timeAgo(message.receivedAt)}
                </time>
                <button
                  className={styles.dismiss}
                  onClick={() => onDismiss(message.id)}
                  title="Dismiss — shows the next most important message"
                  aria-label={`Dismiss ${message.subject || '(no subject)'}`}
                >
                  <Icon name="close" />
                </button>
              </header>
              {/* The link covers the whole row (see `.subject::after`), but its
                  accessible name stays the subject alone. */}
              <a
                className={styles.subject}
                href={gmailUrl(message.id)}
                target="_blank"
                rel="noreferrer"
              >
                {message.subject || '(no subject)'}
              </a>
              {message.snippet && <p>{message.snippet}</p>}
              <p className={styles.reason}>{pick.reason}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Props for {@link Dismissed}. */
interface DismissedProps {
  /** The dismissed messages still in the ranking, newest dismissal first. */
  picks: RankedMail[];
  /** Brings one message back. */
  onRestore: (id: string) => void;
  /** Brings all of them back. */
  onRestoreAll: () => void;
}

/**
 * What has been dismissed, and how to take it back.
 *
 * Two forms of the same thing, because the panel has two sizes. The card gets a
 * single line and a way to undo the lot: it has room for three messages, and
 * spending one of those rows on mail you already waved away would defeat the
 * dismissing. Full screen gets the messages themselves, each with its own
 * Restore — which is where you would go looking, having dismissed one and
 * changed your mind.
 *
 * A component rather than something {@link MailWidget} decides inline, because
 * only a component *inside* the widget body can read {@link useWidgetExpanded}.
 * `MailWidget` builds that body, so it sits above the provider the dialog wraps
 * it in and would read `false` even at full screen.
 *
 * Says "dismissed" throughout, never "deleted": the messages are untouched in
 * Gmail, and a panel wired to someone's real inbox has no business implying
 * otherwise.
 *
 * @param props - See {@link DismissedProps}.
 */
function Dismissed({ picks, onRestore, onRestoreAll }: DismissedProps) {
  const expanded = useWidgetExpanded();
  if (picks.length === 0) return null;

  if (!expanded) {
    return (
      <p className={styles.hiddenNote}>
        {picks.length} dismissed{' '}
        <button className={styles.link} onClick={onRestoreAll}>
          Restore
        </button>
      </p>
    );
  }

  return (
    <section className={styles.recent}>
      <header>
        <h3>Recently dismissed</h3>
        {/* Restoring six one at a time is a chore nobody should have to do. */}
        {picks.length > 1 && (
          <button className={styles.link} onClick={onRestoreAll}>
            Restore all
          </button>
        )}
      </header>
      <ul>
        {picks.map(({ message }) => {
          const subject = message.subject || '(no subject)';
          return (
            <li key={message.id}>
              <span>{senderName(message.from)}</span>
              <span>{subject}</span>
              <button
                className={styles.link}
                onClick={() => onRestore(message.id)}
                aria-label={`Restore ${subject}`}
              >
                Restore
              </button>
            </li>
          );
        })}
      </ul>
      <p>
        Dismissing only hides a message here — nothing was removed from Gmail. These drop off
        the list as they age out of the last seven days.
      </p>
    </section>
  );
}

/**
 * The messages most worth your attention, scored in this browser.
 *
 * Three of them in the card, {@link EXPANDED_N} at full screen — one ranking,
 * two windows onto it. See {@link Picks}.
 *
 * Needs a Google client id for Gmail (ADR 0002) and nothing else — no API key,
 * no third party. Mail is read as metadata only (sender, recipients, a handful
 * of routing headers, and Gmail's own short preview), scored by
 * `importantMail.ts`, and rendered. Nothing read here is sent anywhere
 * (ADR 0010).
 *
 * Ranking is cached mostly to spare the Gmail API, not because it is expensive:
 * every pick carries the signals that produced it, so a wrong answer can be
 * hovered rather than guessed at.
 *
 * A pick can be dismissed, which promotes the next one off the ranking — the
 * panel holds a window onto the full ordering rather than a fixed three. A
 * dismissal is a local act only: it hides a message here and never touches the
 * mail itself, which stays exactly as unread in Gmail as it was.
 */
export default function MailWidget() {
  const [connected, setConnected] = useLocalStorage<boolean>('mail.connected', false);
  /**
   * Ids of messages the user has waved away, kept so they stay gone across a
   * refresh and a reload — a dismissal that lasted only until the next poll
   * would be a worse answer than no dismissal at all.
   */
  const [dismissed, setDismissed] = useLocalStorage<string[]>('mail.dismissed', []);
  const [connectError, setConnectError] = useState('');

  const configured = hasGoogleClientId();

  const load = useCallback(async (): Promise<RankedMail[]> => {
    // `useCachedResource` runs its loader on mount whatever its key says, so
    // this guard is what stops the panel reaching for the user's mail before
    // they have asked it to.
    if (!connected) throw new Error('Gmail is not connected.');

    // The profile address is independent of the inbox, so it rides alongside;
    // known senders are derived from the candidates and have to follow. Both
    // fail soft — losing either costs a signal, not the ranking.
    const [inbox, self] = await Promise.all([fetchInbox(false), fetchProfileEmail()]);
    const knownSenders = await fetchKnownSenders(inbox);

    return rankMail(inbox, { self, knownSenders }, Date.now());
  }, [connected]);

  const ranking = useCachedResource<RankedMail[]>(
    `mail:top:${connected ? 'on' : 'off'}`,
    TTL_MS,
    load,
  );

  const ranked = ranking.data ?? [];
  const hidden = new Set(dismissed);
  /**
   * Everything still wanted, in ranked order. Kept whole here: how much of it
   * fits depends on which size is rendering, which only {@link Picks} knows.
   */
  const kept = ranked.filter((pick) => !hidden.has(pick.message.id));

  /**
   * What has been dismissed, newest dismissal first.
   *
   * Derived from the ranking rather than stored: the messages are still in it —
   * being hidden is what `dismissed` does — so there is nothing to keep in
   * storage beyond the ids already there. It expires correctly for free, too. A
   * message that ages out of the ranking leaves this list on the same pass that
   * prunes its id, so "recently" stays true without a clock to enforce it.
   */
  const dismissedPicks = ranked
    .filter((pick) => hidden.has(pick.message.id))
    .sort((a, b) => dismissed.indexOf(b.message.id) - dismissed.indexOf(a.message.id));

  /**
   * Forgets dismissals for mail that has left the ranking.
   *
   * Without this the list only grows: every message ever dismissed would be
   * remembered forever, long after it aged out of the seven-day window the panel
   * even looks at. Pruning against what is currently ranked keeps the stored
   * list to the handful of ids that can still do anything.
   *
   * Deliberately skipped unless a ranking is actually in hand — pruning against
   * an empty `loading` state would forget every dismissal on each reload.
   */
  useEffect(() => {
    if (ranking.status !== 'ready' || !ranking.data) return;
    const live = new Set(ranking.data.map((pick) => pick.message.id));
    if (dismissed.every((id) => live.has(id))) return;
    setDismissed(dismissed.filter((id) => live.has(id)));
  }, [ranking.status, ranking.data, dismissed, setDismissed]);

  /**
   * Asks Google for mail access with a consent screen if one is needed.
   *
   * The only path here that may do that, and the reason it exists twice below.
   * Everything the panel does on its own passes `interactive: false`, which
   * reuses the Google session already in the browser and rejects when there is
   * not one — a token lives in memory for about an hour, and a silent renewal
   * only works while that session is alive. When it is not, no amount of
   * retrying the silent read will ever succeed; a consent screen is required,
   * and Google will only open one from a user gesture. So a click is the sole
   * way back, which makes offering that click a correctness matter rather than a
   * convenience.
   *
   * @param after - What to do once access is granted. Connecting for the first
   *   time flips `connected`, which moves the cache key and loads on its own;
   *   reconnecting keeps the same key and has to ask for the reload itself.
   */
  const authorize = async (after: () => void) => {
    setConnectError('');
    try {
      await fetchInbox(true);
      after();
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Could not connect to Gmail.');
    }
  };

  const connect = () => authorize(() => setConnected(true));
  const reconnect = () => authorize(ranking.refresh);


  const body = () => {
    if (!configured) {
      return (
        <p className={styles.empty}>
          Mail needs a Google client id. Set <code>VITE_GOOGLE_CLIENT_ID</code> and reload.
        </p>
      );
    }

    if (!connected) {
      return (
        <>
          <p className={styles.explain}>
            Connect Gmail to see the {TOP_N} messages most worth your attention. Mail is read as
            metadata — sender, recipients, and Gmail’s short preview — and scored here in your
            browser. Nothing is sent anywhere.
          </p>
          <button className={styles.add} onClick={connect}>
            Connect Gmail
          </button>
          {connectError && <p className={styles.error}>{connectError}</p>}
        </>
      );
    }

    if (ranking.status === 'loading') {
      // Placeholder rows rather than a line of text: they occupy the shape the
      // answer will take, so the panel does not jump when it arrives.
      return (
        <div className={styles.skeleton} role="status" aria-label="Reading your inbox">
          {[0, 1, 2].map((row) => (
            <div key={row}>
              <span className={styles.bar} />
              <div>
                <span className={styles.bar} />
                <span className={styles.bar} />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (ranking.status === 'error') {
      return (
        <>
          {/* The reason, not just the fact. "Couldn't read your mail" on its own
              cannot be acted on, and the two things that cause it want opposite
              responses. */}
          <p className={styles.error}>
            Couldn’t read your mail{ranking.error ? `: ${ranking.error.message}` : '.'}
          </p>
          <p className={styles.explain}>
            A blip wants the same read again. If retrying keeps failing, the Google session
            this panel was using has expired — reconnecting is what asks for a new one, and
            only your click can open Google’s consent screen.
          </p>
          <button className={styles.add} onClick={reconnect}>
            Reconnect Gmail
          </button>{' '}
          <button className={styles.link} onClick={ranking.refresh}>
            Retry
          </button>
          {connectError && <p className={styles.error}>{connectError}</p>}
        </>
      );
    }

    if (kept.length === 0 && dismissedPicks.length === 0) {
      return <p className={styles.empty}>Nothing in the last week needs you. Enjoy it.</p>;
    }

    return (
      <>
        {/* Distinct from an inbox that never had anything: this one you emptied
            by hand, and the way back is directly below. */}
        {kept.length === 0 ? (
          <p className={styles.empty}>That’s everything — you’ve dismissed the rest.</p>
        ) : (
          <Picks kept={kept} onDismiss={(id) => setDismissed([...dismissed, id])} />
        )}

        {/* Says what is being kept from you, and undoes it. Without this a
            dismissal is a one-way door with no sign on it. */}
        <Dismissed
          picks={dismissedPicks}
          onRestore={(id) => setDismissed(dismissed.filter((each) => each !== id))}
          onRestoreAll={() => setDismissed([])}
        />

        {/* Cached mail is still worth showing when a refresh fails — but it has
            to say so. Silently, this panel will present a fortnight-old inbox as
            today's for as long as the cache survives, which is how an expired
            session goes unnoticed until something clears the cache and the
            failure finally has nothing left to hide behind. */}
        {ranking.error && (
          <p className={styles.hiddenNote}>
            Showing older mail — the last refresh failed.{' '}
            <button className={styles.link} onClick={reconnect}>
              Reconnect
            </button>
          </p>
        )}
      </>
    );
  };

  return (
    <Widget
      title="Mail"
      className={styles.container}
      // Two things the card cannot give: depth — ten picks rather than three —
      // and width, for the subject, preview and reason that truncate first.
      expandable
      action={
        connected && (
          <button
            className={styles.toggle}
            onClick={ranking.refresh}
            disabled={ranking.revalidating}
            title="Re-read the inbox now"
            aria-label="Refresh mail now"
          >
            <Icon name="refresh" />
          </button>
        )
      }
    >
      {body()}
    </Widget>
  );
}
