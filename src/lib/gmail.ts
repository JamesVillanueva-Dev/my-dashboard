/**
 * Read-only Gmail access for the mail panel.
 *
 * Deliberately fetches messages with `format=metadata`. That is not a size
 * optimisation — it is the privacy boundary, enforced at the API rather than in
 * our own code: Gmail returns headers and its own short `snippet` and simply
 * does not include `payload.body`, so a message body cannot reach this app at
 * all (ADR 0010). A future change that wanted bodies would have to say so out
 * loud by changing this parameter.
 *
 * Since ranking moved into the browser (ADR 0010, superseding 0009), nothing
 * read here is forwarded anywhere: the metadata below is fetched, scored, and
 * rendered without leaving the page. The header list is written out in full for
 * the same reason the format is pinned — what this app looks at should be
 * readable, not inferred.
 *
 * This module parses. It does not judge: whether a message is "bulk" or
 * "important" is `importantMail.ts`'s business, and what leaves here is a
 * faithful reading of what Gmail sent.
 */

import { load } from './cache';
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
 * How many messages to consider.
 *
 * Raised from 25 once ranking became free and local. The cost is one metadata
 * round trip per message — parallel, so it is connection-pool pressure rather
 * than latency — and the benefit is recall: Gmail returns the *newest* N, so a
 * small N quietly biases the candidate set toward recency, which is the exact
 * failure this panel exists to avoid. 35 covers a busy week without turning a
 * refresh into a hundred requests.
 */
const CANDIDATES = 35;

/**
 * How long a "have I written to this person" answer is trusted.
 *
 * Long, because the underlying fact barely moves — you do not start and stop
 * corresponding with someone inside a week — and because without it this lookup
 * would re-ask Gmail about every sender on every refresh, which would cost more
 * requests than reading the inbox does.
 */
const KNOWN_SENDER_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The headers requested for every message.
 *
 * Named explicitly, and kept short on purpose: this list *is* the answer to
 * "what does this app read from my mail", so it should be short enough to read
 * and every entry should earn its place. `Reply-To` and `Return-Path` were
 * considered and left out — both are largely redundant once `From` and
 * `Precedence` are in hand.
 */
const HEADERS = [
  // Who and what.
  'From',
  'Subject',
  'Date',
  // Whether it was addressed to you, and how many others.
  'To',
  'Cc',
  'Delivered-To',
  // Whether it is a mailing rather than a message.
  'List-Unsubscribe',
  'List-Id',
  'Precedence',
  'Auto-Submitted',
  // Whether it replies into a conversation.
  'In-Reply-To',
  'References',
] as const;

/** The Gmail labels ranking reads, resolved from raw `labelIds`. */
export interface MailLabels {
  /** Gmail's own priority classifier said so. Personalised to this user. */
  important: boolean;
  /** The user starred it — an explicit act, not an inference. */
  starred: boolean;
  /** `CATEGORY_UPDATES`: receipts, notifications, automated mail. */
  updates: boolean;
  /** `CATEGORY_FORUMS`: mailing lists and group threads. */
  forums: boolean;
}

/** One message, reduced to what ranking needs. */
export interface MailSummary {
  /** Gmail's message id — also what an "open in Gmail" link is built from. */
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
  /** Bare addresses from `To`, lowercased. */
  to: string[];
  /** Bare addresses from `Cc`, lowercased. */
  cc: string[];
  /**
   * Bare addresses from `Delivered-To`, lowercased. This is which of *your*
   * addresses the message arrived at, so it catches aliases that `To` names
   * differently — and stands in for the profile address when that lookup fails.
   */
  deliveredTo: string[];
  /**
   * `List-Unsubscribe` or `List-Id` present — the most reliable "this is a
   * mailing, not a message" tell there is.
   */
  listHeaders: boolean;
  /** `Precedence: bulk|list|junk`, or an `Auto-Submitted` other than `no`. */
  autoHeaders: boolean;
  /** `In-Reply-To` or `References` present — it replies into a thread. */
  threaded: boolean;
  /** The Gmail labels ranking reads. */
  labels: MailLabels;
}

/** The shape Gmail returns for `format=metadata`. */
interface GmailMessage {
  /** Absent only on a malformed response; such messages are dropped. */
  id?: string;
  /** Gmail's own preview text. */
  snippet?: string;
  /** Epoch ms as a string — Gmail sends it that way. */
  internalDate?: string;
  /** Gmail's labels, resolved into {@link MailLabels}. */
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

/**
 * Splits a header address list on the commas that actually separate addresses.
 *
 * A naive `split(',')` is wrong, and wrong on real mail rather than on a corner
 * case: `"Smith, Alice" <a@x.com>, bob@y.com` is two recipients, not three.
 * Commas inside a quoted display name or inside angle brackets are part of the
 * address, so both are tracked while scanning.
 */
function splitAddresses(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let angled = false;

  for (const ch of value) {
    // The delimiters are kept in `current` — `toAddress` needs the angles to
    // find the address inside a `Name <addr>` pair.
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '<') angled = true;
    else if (!quoted && ch === '>') angled = false;
    else if (!quoted && !angled && ch === ',') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * The bare address out of one list entry, lowercased, or '' when the entry
 * holds no address at all — a group syntax like `undisclosed-recipients:;`
 * parses to nothing rather than to a bogus recipient.
 */
function toAddress(part: string): string {
  const angled = part.match(/<([^>]*)>/);
  const raw = (angled ? angled[1] : part).trim().replace(/^"|"$/g, '');
  return raw.includes('@') ? raw.toLowerCase() : '';
}

/**
 * Every address in a `To`/`Cc`/`Delivered-To` header value, lowercased.
 *
 * @param value - The raw header, or '' when the message had none.
 * @returns Bare addresses in header order. Empty when nothing parses.
 */
export function parseAddressList(value: string): string[] {
  return splitAddresses(value).map(toAddress).filter(Boolean);
}

/** Reads one header as an address list. */
function addresses(message: GmailMessage, name: string): string[] {
  return parseAddressList(header(message, name));
}

/** Resolves the labels ranking reads out of Gmail's raw label ids. */
function toLabels(labelIds: string[] | undefined): MailLabels {
  const has = (id: string) => labelIds?.includes(id) ?? false;
  return {
    important: has('IMPORTANT'),
    starred: has('STARRED'),
    updates: has('CATEGORY_UPDATES'),
    forums: has('CATEGORY_FORUMS'),
  };
}

/** Turns one raw Gmail message into a {@link MailSummary}, or `null` if unusable. */
export function toSummary(message: GmailMessage): MailSummary | null {
  if (!message.id) return null;
  const received = Number(message.internalDate);
  const autoSubmitted = header(message, 'Auto-Submitted').toLowerCase();
  const precedence = header(message, 'Precedence').toLowerCase();

  return {
    id: message.id,
    from: header(message, 'From'),
    subject: header(message, 'Subject'),
    // Gmail HTML-escapes its snippets; leaving that raw would render "&amp;" to
    // the user in the one field that is quoted verbatim from their mail.
    snippet: decodeEntities(message.snippet ?? ''),
    receivedAt: Number.isFinite(received) ? received : 0,
    unread: message.labelIds?.includes('UNREAD') ?? false,
    to: addresses(message, 'To'),
    cc: addresses(message, 'Cc'),
    deliveredTo: addresses(message, 'Delivered-To'),
    listHeaders: Boolean(header(message, 'List-Unsubscribe') || header(message, 'List-Id')),
    // `Auto-Submitted: no` is the spec's way of saying "a human sent this", so
    // only some *other* value marks automation.
    autoHeaders:
      ['bulk', 'list', 'junk'].includes(precedence) ||
      (autoSubmitted !== '' && autoSubmitted !== 'no'),
    threaded: Boolean(header(message, 'In-Reply-To') || header(message, 'References')),
    labels: toLabels(message.labelIds),
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

/** The bare address out of a `From` header, lowercased, or '' if none parses. */
export function senderAddress(from: string): string {
  return parseAddressList(from)[0] ?? '';
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

  // `metadataHeaders` keeps the response to the headers ranking reads; without
  // it Gmail returns every header on the message.
  const headers = HEADERS.map((h) => `metadataHeaders=${h}`).join('&');
  const messages = await Promise.all(
    ids.map((id) => api<GmailMessage>(`/messages/${id}?format=metadata&${headers}`, token)),
  );

  return messages
    .map(toSummary)
    .filter((m): m is MailSummary => m !== null)
    .sort((a, b) => b.receivedAt - a.receivedAt);
}

/**
 * The signed-in user's own address, for telling "addressed to me" from "I am on
 * the list".
 *
 * Fails soft on purpose: without it the scorer skips its addressing signals and
 * still ranks, which is a slightly worse answer rather than no panel at all.
 *
 * @returns The address lowercased, or `null` if it could not be read.
 */
export async function fetchProfileEmail(): Promise<string | null> {
  try {
    const token = await getAccessToken(false, GMAIL_SCOPE);
    const profile = await api<{ emailAddress?: string }>('/profile', token);
    return profile.emailAddress?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/**
 * Which of `messages`' senders the user has written to before.
 *
 * Having emailed someone is the strongest available proxy for a real
 * relationship, and it is cheap to ask: one *list* query per unique sender,
 * `maxResults=1`, reading only `resultSizeEstimate`. No message is fetched, and
 * each answer is cached for {@link KNOWN_SENDER_TTL_MS} — so a dashboard left
 * open re-asks about a sender every few days rather than every few minutes.
 *
 * Like {@link fetchProfileEmail} this fails soft — per sender, so one bad
 * lookup costs one signal rather than the whole set.
 *
 * @param messages - The candidates whose senders should be checked.
 * @returns The subset of sender addresses the user has sent mail to.
 */
export async function fetchKnownSenders(messages: MailSummary[]): Promise<Set<string>> {
  const senders = [...new Set(messages.map((m) => senderAddress(m.from)).filter(Boolean))];
  if (senders.length === 0) return new Set();

  let token: string;
  try {
    token = await getAccessToken(false, GMAIL_SCOPE);
  } catch {
    return new Set();
  }

  const known = await Promise.all(
    senders.map(async (address) => {
      try {
        const written = await load(`mail:sender:${address}`, KNOWN_SENDER_TTL_MS, async () => {
          const found = await api<{ resultSizeEstimate?: number }>(
            `/messages?q=${encodeURIComponent(`in:sent to:${address}`)}&maxResults=1`,
            token,
          );
          return (found.resultSizeEstimate ?? 0) > 0;
        });
        return written ? address : '';
      } catch {
        return '';
      }
    }),
  );

  return new Set(known.filter(Boolean));
}
