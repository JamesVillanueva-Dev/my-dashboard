/**
 * Read-only Gmail access for the mail panel.
 *
 * Deliberately fetches messages with `format=metadata`. That is not a size
 * optimisation — it is the privacy boundary, enforced at the API rather than in
 * our own code: Gmail returns headers and its own short `snippet` and simply
 * does not include `payload.body`, so a message body cannot reach this app, let
 * alone be forwarded to Anthropic for ranking (ADR 0009). A future change that
 * wanted bodies would have to say so out loud by changing this parameter.
 */

import { GMAIL_SCOPE, getAccessToken } from './googleAuth';

/** Gmail API v1 root, already scoped to the signed-in user. */
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * Which mail is a candidate for "most important".
 *
 * Scoped to the primary inbox and the last week: promotions and social updates
 * are not what anyone means by an important email, and a message old enough to
 * have been ignored for a week is not news.
 */
const QUERY = 'in:inbox newer_than:7d -category:promotions -category:social -in:chats';

/**
 * How many messages to consider. Ranking quality stops improving well before
 * this, and every extra message is another metadata round trip.
 */
const CANDIDATES = 25;

/** One message, reduced to what ranking needs. */
export interface MailSummary {
  /** Gmail's message id — also what a "open in Gmail" link is built from. */
  id: string;
  /** Display name and address from the `From` header, as Gmail formatted it. */
  from: string;
  /** The `Subject` header, or '' when the message has none. */
  subject: string;
  /** Gmail's own ~100-character preview. Never the body. */
  snippet: string;
  /** Epoch ms; Gmail's `internalDate`. */
  receivedAt: number;
  /** Whether the message still carries the `UNREAD` label. */
  unread: boolean;
}

/** The shape Gmail returns for `format=metadata`. */
interface GmailMessage {
  /** Absent only on a malformed response; such messages are dropped. */
  id?: string;
  /** Gmail's own preview text. */
  snippet?: string;
  /** Epoch ms as a string — Gmail sends it that way. */
  internalDate?: string;
  /** Gmail's labels; only `UNREAD` is read. */
  labelIds?: string[];
  /**
   * Headers only. `format=metadata` means there is no `body` here to read — see
   * the note at the top of this file.
   */
  payload?: { headers?: { name?: string; value?: string }[] };
}

/** Case-insensitive header lookup — Gmail does not promise a casing. */
function header(message: GmailMessage, name: string): string {
  const found = message.payload?.headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? '';
}

/** Turns one raw Gmail message into a {@link MailSummary}, or `null` if unusable. */
export function toSummary(message: GmailMessage): MailSummary | null {
  if (!message.id) return null;
  const received = Number(message.internalDate);
  return {
    id: message.id,
    from: header(message, 'From'),
    subject: header(message, 'Subject'),
    // Gmail HTML-escapes its snippets; leaving that raw would render "&amp;" to
    // the user in the one field that is quoted verbatim from their mail.
    snippet: decodeEntities(message.snippet ?? ''),
    receivedAt: Number.isFinite(received) ? received : 0,
    unread: message.labelIds?.includes('UNREAD') ?? false,
  };
}

/**
 * The display name out of a `From` header — `Alice Smith <a@x.com>` → `Alice
 * Smith`. A bare address, or anything that doesn't parse, is returned unchanged;
 * showing the raw header beats showing nothing.
 */
export function senderName(from: string): string {
  const named = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (named ? named[1] : from).trim();
}

/** Decodes the handful of entities Gmail puts in snippets. */
function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    // Ampersand last, so "&amp;lt;" does not decode twice into "<".
    .replace(/&amp;/g, '&');
}

/** GETs `path` with the Gmail bearer token, throwing a readable error on failure. */
async function api<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const detail = response.status === 403 ? ' — is the Gmail API enabled for this project?' : '';
    throw new Error(`Gmail request failed (${response.status})${detail}`);
  }
  return (await response.json()) as T;
}

/**
 * Fetches recent inbox messages as metadata only.
 *
 * @param interactive - `true` when a user gesture triggered this, so Google may
 *   show its consent popup. See `getAccessToken`.
 * @returns Newest first. Empty when the inbox has nothing matching {@link QUERY}.
 */
export async function fetchInbox(interactive: boolean): Promise<MailSummary[]> {
  const token = await getAccessToken(interactive, GMAIL_SCOPE);

  const list = await api<{ messages?: { id: string }[] }>(
    `/messages?q=${encodeURIComponent(QUERY)}&maxResults=${CANDIDATES}`,
    token,
  );
  const ids = (list.messages ?? []).map((m) => m.id);
  if (ids.length === 0) return [];

  // `metadataHeaders` keeps the response to the three headers ranking reads;
  // without it Gmail returns every header on the message.
  const headers = ['From', 'Subject', 'Date'].map((h) => `metadataHeaders=${h}`).join('&');
  const messages = await Promise.all(
    ids.map((id) => api<GmailMessage>(`/messages/${id}?format=metadata&${headers}`, token)),
  );

  return messages
    .map(toSummary)
    .filter((m): m is MailSummary => m !== null)
    .sort((a, b) => b.receivedAt - a.receivedAt);
}
