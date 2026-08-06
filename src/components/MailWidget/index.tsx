import { useCallback, useState } from 'react';
import Widget from '../Widget';
import Icon from '../Icon';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useCachedResource } from '../../hooks/useCachedResource';
import { hasGoogleClientId } from '../../lib/googleAuth';
import { fetchInbox, fetchKnownSenders, fetchProfileEmail, senderName } from '../../lib/gmail';
import { rankMail, TOP_N, type RankedMail } from '../../lib/importantMail';
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

/**
 * The three messages most worth your attention, scored in this browser.
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
 */
export default function MailWidget() {
  const [connected, setConnected] = useLocalStorage<boolean>('mail.connected', false);
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

  const connect = async () => {
    setConnectError('');
    try {
      // Interactive: this is a click, so Google may show its consent popup.
      await fetchInbox(true);
      setConnected(true);
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Could not connect to Gmail.');
    }
  };

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
        <p className={styles.error}>
          Couldn’t read your mail.{' '}
          <button className={styles.link} onClick={ranking.refresh}>
            Retry
          </button>
        </p>
      );
    }

    const picks = ranking.data ?? [];
    if (picks.length === 0) {
      return <p className={styles.empty}>Nothing in the last week needs you. Enjoy it.</p>;
    }

    return (
      <ol className={styles.list}>
        {picks.map((pick) => {
          const { message } = pick;
          const sender = senderName(message.from);
          return (
            <li
              key={message.id}
              className={message.unread ? styles.isUnread : undefined}
              title={breakdown(pick)}
            >
              <span className={styles.avatar} aria-hidden="true">
                {initial(sender)}
              </span>
              <div>
                <header>
                  <span>{sender}</span>
                  <time dateTime={new Date(message.receivedAt).toISOString()}>
                    {timeAgo(message.receivedAt)}
                  </time>
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
  };

  return (
    <Widget
      title="Mail"
      className={styles.container}
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
