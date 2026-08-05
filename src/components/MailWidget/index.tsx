import { useCallback, useState, type FormEvent } from 'react';
import Widget from '../Widget';
import Icon from '../Icon';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useCachedResource } from '../../hooks/useCachedResource';
import { hasGoogleClientId } from '../../lib/googleAuth';
import { fetchInbox, senderName } from '../../lib/gmail';
import { rankMail, TOP_N, type RankedMail } from '../../lib/importantMail';
import {
  anthropicKey,
  clearSessionKey,
  keySource,
  looksLikeKey,
  setSessionKey,
} from '../../lib/anthropicKey';
import styles from './styles.module.css';

/**
 * How long a ranking stays fresh.
 *
 * Longer than the other panels on purpose: every refresh is a paid Claude call,
 * so re-ranking on each render or each mount would turn an idle dashboard into a
 * recurring charge. Fifteen minutes keeps the panel useful while making the
 * manual refresh the way to get an answer *now*.
 */
const TTL_MS = 15 * 60 * 1000;

/** Deep link to one message in the Gmail web client. */
const gmailUrl = (id: string) => `https://mail.google.com/mail/u/0/#inbox/${id}`;

/**
 * The three messages most worth your attention, chosen by Claude.
 *
 * Two integrations have to be present for this panel to do anything, and it says
 * which is missing rather than failing blankly: a Google client id for Gmail
 * (ADR 0002) and an Anthropic API key for the ranking (ADR 0009). Mail is read
 * as metadata only — sender, subject, and Gmail's own short preview — so message
 * bodies never leave Gmail.
 *
 * Ranking is cached and refreshed on a timer rather than on mount, because
 * unlike every other panel here a refresh costs money.
 */
export default function MailWidget() {
  const [connected, setConnected] = useLocalStorage<boolean>('mail.connected', false);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyError, setKeyError] = useState('');
  const [connectError, setConnectError] = useState('');
  /** Bumped when a key is pasted, so the memoised key check re-reads storage. */
  const [keyEpoch, setKeyEpoch] = useState(0);

  const configured = hasGoogleClientId();
  const source = keySource();
  const hasKey = source !== 'none';

  const load = useCallback(async (): Promise<RankedMail[]> => {
    // `useCachedResource` runs its loader on mount whatever its key says, so
    // these guards are what stop the panel reaching for the user's mail — and
    // spending their Anthropic credit — before they have asked it to.
    if (!connected) throw new Error('Gmail is not connected.');
    const key = anthropicKey();
    if (!key) throw new Error('No Anthropic API key.');
    const inbox = await fetchInbox(false);
    return rankMail(inbox, key);
  }, [connected]);

  // The key is part of the cache key only as a "do we have one" flag — never its
  // value, which would write the credential into localStorage via the cache.
  const ranking = useCachedResource<RankedMail[]>(
    `mail:top:${connected && hasKey ? `on:${keyEpoch}` : 'off'}`,
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

  const saveKey = (e: FormEvent) => {
    e.preventDefault();
    if (!looksLikeKey(keyDraft)) {
      setKeyError('That doesn’t look like an Anthropic key — they start with “sk-ant-”.');
      return;
    }
    setSessionKey(keyDraft);
    setKeyDraft('');
    setKeyError('');
    setKeyEpoch((n) => n + 1);
  };

  const forgetKey = () => {
    clearSessionKey();
    setKeyEpoch((n) => n + 1);
  };

  const body = () => {
    if (!configured) {
      return (
        <p className={styles.empty}>
          Mail needs a Google client id. Set <code>VITE_GOOGLE_CLIENT_ID</code> and reload.
        </p>
      );
    }

    if (!hasKey) {
      return (
        <form className={styles.form} onSubmit={saveKey}>
          <p className={styles.explain}>
            Ranking uses Claude, so this panel needs an Anthropic API key. It is kept for this
            tab only and never saved to your account. Sender, subject and Gmail’s short preview
            are sent for ranking — message bodies are not.
          </p>
          <input
            type="password"
            placeholder="sk-ant-…"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            aria-label="Anthropic API key"
          />
          <button className={styles.add} type="submit">
            Save key
          </button>
          {keyError && <p className={styles.error}>{keyError}</p>}
        </form>
      );
    }

    if (!connected) {
      return (
        <>
          <p className={styles.explain}>
            Connect Gmail to see the {TOP_N} messages most worth your attention.
          </p>
          <button className={styles.add} onClick={connect}>
            Connect Gmail
          </button>
          {connectError && <p className={styles.error}>{connectError}</p>}
        </>
      );
    }

    if (ranking.status === 'loading') return <p className={styles.empty}>Reading your inbox…</p>;

    if (ranking.status === 'error') {
      return (
        <p className={styles.error}>
          Couldn’t rank your mail.{' '}
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
        {picks.map(({ message, reason }) => (
          <li key={message.id}>
            <a href={gmailUrl(message.id)} target="_blank" rel="noreferrer">
              {message.subject || '(no subject)'}
            </a>
            <p className={styles.meta}>{senderName(message.from)}</p>
            <p className={styles.reason}>{reason}</p>
          </li>
        ))}
      </ol>
    );
  };

  return (
    <Widget
      title="Mail"
      className={styles.container}
      action={
        <>
          {hasKey && connected && (
            <button
              className={styles.toggle}
              onClick={ranking.refresh}
              disabled={ranking.revalidating}
              title="Re-rank now (uses your Anthropic credit)"
              aria-label="Re-rank mail now"
            >
              <Icon name="refresh" />
            </button>
          )}
          {source === 'session' && (
            <button
              className={styles.toggle}
              onClick={forgetKey}
              title="Forget the API key stored for this tab"
              aria-label="Forget API key"
            >
              <Icon name="close" />
            </button>
          )}
        </>
      }
    >
      {body()}
      {hasKey && connected && (
        <p className={styles.hint}>
          Ranked by Claude from sender, subject and preview. Bodies stay in Gmail.
        </p>
      )}
    </Widget>
  );
}
