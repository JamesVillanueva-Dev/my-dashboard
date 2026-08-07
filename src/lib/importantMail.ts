/**
 * Picks the three most important messages out of a recent inbox, in the browser.
 *
 * The score is `Σ points × Π factors`. Additive points are what a message has
 * going for it; the factors are gates that no amount of points can out-add,
 * which is the whole reason a newsletter cannot climb into the list by being
 * long, recent, and addressed to you (ADR 0010).
 *
 * Two properties are load-bearing and should survive any edit here:
 *
 * - **It is pure.** No `fetch`, no `Date.now()`, no React. Everything it needs
 *   arrives in {@link RankContext} and `now`. That is what makes every weight
 *   below arguable against a fixture instead of against a live inbox.
 * - **It explains itself.** Every score carries the {@link Signal}s that made
 *   it, so a wrong pick can be inspected rather than shrugged at. This is the
 *   main thing the heuristic has over the model it replaced.
 *
 * Weights are relative, not absolute; the only number with meaning on its own
 * is {@link FLOOR}. Read them against each other.
 */

import { senderAddress, type MailSummary } from './gmail';

/**
 * How many messages the panel shows at once.
 *
 * A property of the panel, not of the ranking: {@link rankMail} orders
 * everything worth showing and the panel takes this many off the top, so
 * dismissing one can promote the next rather than leaving a gap.
 */
export const TOP_N = 3;

/**
 * The score a message must clear to be shown at all.
 *
 * A heuristic always produces a top three, even from three newsletters — this
 * is what lets the panel say "nothing" instead of dressing up junk. Calibrated
 * so that a plain note from a real person addressed only to you (~26) clears it
 * and nothing automated does without a genuine ask.
 */
export const FLOOR = 20;

/** Longest reason line the panel renders before it falls back to one clause. */
const REASON_MAX = 90;

// --- Additive weights -------------------------------------------------------
//
// Read as: a direct ask from a person who addressed you personally (+14 +8 +10)
// should beat Gmail's own guess (+18), and a star should beat almost anything.

/** An explicit human act. Nothing merely inferred should outrank it. */
export const STARRED = 25;

/**
 * Gmail's own priority classifier — personalised to this user in a way no rule
 * here can be, and free. Deliberately *below* the sum of direct addressing and
 * a direct request, so the panel is not just a re-skinned Priority Inbox.
 */
export const IMPORTANT = 18;

/** Your address in `To`: someone chose to write to you. */
export const TO_DIRECT = 14;

/** Your address only in `Cc`: you were informed, not asked. */
export const CC_ONLY = 4;

/** One recipient in total — a one-to-one message. */
export const SOLE_RECIPIENT = 8;

/** Two to five recipients — a small group rather than an announcement. */
export const SMALL_GROUP = 3;

/** Six or more recipients earns nothing; that is a broadcast. */
export const GROUP_LIMIT = 5;

/** `In-Reply-To`/`References`: someone replied into a thread. */
export const THREADED = 10;

/** A `Re:` subject. Overlaps with {@link THREADED} on purpose — it catches
 *  clients that drop the header, and stacking slightly on a real reply is fine. */
export const RE_SUBJECT = 4;

/** A `Fwd:` subject. Weaker: a forward is usually FYI, not an ask. */
export const FWD_SUBJECT = 2;

/** Something breaks if this is ignored. The strongest content signal. */
export const TRANSACTIONAL = 12;

/** Someone asked you to do a specific thing. */
export const DIRECT_REQUEST = 10;

/** A question in the subject — the most visible form of an ask. */
export const QUESTION_SUBJECT = 8;

/** A date attached to the ask. */
export const DEADLINE = 8;

/** A question in the preview text; weaker than one in the subject. */
export const QUESTION_SNIPPET = 4;

/**
 * Unread. Modest by design: a read message you have been avoiding all week may
 * be exactly the one you owe, so this breaks ties rather than deciding them.
 */
export const UNREAD = 6;

/** You have written to this sender before — the best proxy for a real
 *  relationship that metadata can offer. */
export const KNOWN_SENDER = 12;

/** Several messages from one sender this week is usually a system, not a person. */
export const REPEAT_SENDER = -6;

/** How many messages from one sender before {@link REPEAT_SENDER} applies. */
export const REPEAT_SENDER_AT = 3;

// --- Multipliers ------------------------------------------------------------

/**
 * A mailing rather than a message.
 *
 * Applied as a factor, not a penalty, because bulk mail is *always* addressed
 * to you as the sole recipient — so it collects the same +22 a personal note
 * does, and a subtraction large enough to cancel that would also flatten
 * everything else. A quarter cannot be out-added.
 */
export const BULK_FACTOR = 0.25;

/**
 * Bulk, but replying into a thread: GitHub, Jira, Linear, document comments.
 * A machine relaying a human conversation is a different animal from a
 * newsletter, and treating them alike is where a naive bulk gate goes wrong —
 * it buries the pull-request comment that actually asks you something.
 */
export const BULK_THREADED_FACTOR = 0.5;

/** Sales language. Compounds with {@link BULK_FACTOR} to ×0.125. */
export const MARKETING_FACTOR = 0.5;

/** The least recency can scale a score by, at the far edge of the query window. */
export const RECENCY_FLOOR = 0.6;

/** Hours over which recency decays toward {@link RECENCY_FLOOR}. */
export const RECENCY_DECAY_H = 48;

// --- Vocabulary -------------------------------------------------------------
//
// Kept as data, so the lists can be argued with without touching the scoring.
// Matched case-insensitively on word boundaries — a substring match would read
// "duetto" as "due".

/**
 * Something will break if this is ignored. This list is what rescues an
 * automated message from {@link BULK_FACTOR}, so it is kept narrow: consequence,
 * not mere transaction. Receipts and invoices are deliberately absent — they
 * are a record of something already handled.
 */
export const TRANSACTIONAL_PHRASES = [
  'action required',
  'action needed',
  'payment failed',
  'payment declined',
  'card declined',
  'past due',
  'overdue',
  'suspended',
  'expires',
  'expiring',
  'verify your',
  'confirm your',
  'security alert',
  'unusual activity',
  'unauthorized',
  'password reset',
  'final notice',
];

/**
 * Sales language. Does two jobs: scales the score down, and — more importantly —
 * vetoes the transactional rescue above. "Your trial expires Friday" reads as
 * consequence right up until you notice it is also selling something.
 */
export const MARKETING_PHRASES = [
  '% off',
  'sale',
  "don't miss",
  'dont miss',
  'introducing',
  'limited time',
  'exclusive offer',
  'shop now',
  'free trial',
  'upgrade now',
  'best deals',
  'save big',
  'new arrivals',
  'webinar',
  'newsletter',
];

/** Someone asking you to do a specific thing. */
export const REQUEST_PHRASES = [
  'can you',
  'could you',
  'would you',
  'please review',
  'please confirm',
  'please send',
  'please sign',
  'let me know',
  'waiting on',
  'waiting for your',
  'need your',
  'needs your',
  'your thoughts',
  'thoughts on',
  'take a look',
  'sign off',
  'approve',
  'rsvp',
  'get back to me',
  'following up',
  'any update',
];

/** A date attached to an ask. Bare "due" is absent — far too noisy. */
export const DEADLINE_PHRASES = [
  'deadline',
  'due by',
  'due on',
  'due date',
  'is due',
  'are due',
  'no later than',
  'by eod',
  'by end of day',
  'by end of week',
  'by tomorrow',
  'by monday',
  'by tuesday',
  'by wednesday',
  'by thursday',
  'by friday',
  'by saturday',
  'by sunday',
  'this friday',
  'through friday',
];

/** Local parts that mean "a machine sent this and cannot read a reply". */
export const AUTOMATED_SENDER =
  /\b(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounces?)\b/i;

/**
 * Compiles a phrase list into one regex, anchoring word boundaries only where
 * the phrase actually starts or ends with a word character — `\b%` would never
 * match "30% off".
 */
function compile(phrases: string[]): RegExp {
  const parts = phrases.map((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lead = /^\w/.test(phrase) ? '\\b' : '';
    const tail = /\w$/.test(phrase) ? '\\b' : '';
    return `${lead}${escaped}${tail}`;
  });
  return new RegExp(parts.join('|'), 'i');
}

const TRANSACTIONAL_RE = compile(TRANSACTIONAL_PHRASES);
const MARKETING_RE = compile(MARKETING_PHRASES);
const REQUEST_RE = compile(REQUEST_PHRASES);
const DEADLINE_RE = compile(DEADLINE_PHRASES);

// --- Types ------------------------------------------------------------------

/**
 * One reason a message scored what it did.
 *
 * Additive signals carry `points` with `factor: 1`; gates carry `factor` with
 * `points: 0`. One flat list either way, so a breakdown is a `map` rather than
 * a walk over several shapes.
 */
export interface Signal {
  /** Stable identifier, for tests and the debug breakdown. */
  key: string;
  /**
   * How this reads in the panel's reason line, lowercase and clause-shaped.
   * Empty when the signal is real but says nothing a reader needs — a second
   * phrase for a fact already stated, or a gate.
   */
  phrase: string;
  /**
   * Narrative rank for building the reason line: 1 is what the message asks of
   * you, 2 is your relationship to it, 3 is metadata about it. Sorting by
   * points instead would make almost every reason say "Gmail flags it
   * important", which is true and useless.
   */
  tier: 1 | 2 | 3;
  /** Added to the base score. */
  points: number;
  /** Multiplied into the total. */
  factor: number;
}

/** A message's score and everything that produced it. */
export interface Score {
  /** `Σ points × Π factors`, rounded to one decimal for stable comparison. */
  total: number;
  /** Every signal that fired, in the order the scorers ran. */
  signals: Signal[];
}

/** What scoring needs that a single message cannot supply. */
export interface RankContext {
  /** The signed-in user's own address, lowercased, or `null` when unknown. */
  self: string | null;
  /** Sender addresses the user has written to before. */
  knownSenders?: ReadonlySet<string>;
  /** Candidates per sender address. {@link rankMail} fills this in. */
  senderCounts?: ReadonlyMap<string, number>;
}

/** One of the panel's picks. */
export interface RankedMail {
  /** The Gmail message this refers to. */
  message: MailSummary;
  /** One short line on why it matters, built from the dominant signals. */
  reason: string;
  /** The score it cleared {@link FLOOR} with. */
  score: number;
  /** The full breakdown, for the panel's hover explanation. */
  signals: Signal[];
}

/** Text matches, read once per message and shared by the scorers that need them. */
interface Matches {
  transactional: boolean;
  marketing: boolean;
  request: boolean;
  deadline: boolean;
  questionSubject: boolean;
  questionSnippet: boolean;
}

// --- Scorers ----------------------------------------------------------------

/** An additive signal. */
const add = (key: string, phrase: string, tier: 1 | 2 | 3, points: number): Signal => ({
  key,
  phrase,
  tier,
  points,
  factor: 1,
});

/** A multiplicative gate. Gates never speak in the reason line. */
const scale = (key: string, factor: number): Signal => ({
  key,
  phrase: '',
  tier: 3,
  points: 0,
  factor,
});

/** Reads the subject and preview once. */
function readText(message: MailSummary): Matches {
  const subject = message.subject;
  const both = `${subject} ${message.snippet}`;
  return {
    transactional: TRANSACTIONAL_RE.test(both),
    marketing: MARKETING_RE.test(both),
    request: REQUEST_RE.test(both),
    deadline: DEADLINE_RE.test(both),
    questionSubject: subject.includes('?'),
    questionSnippet: message.snippet.includes('?'),
  };
}

/** Gmail's own verdicts: a star, and its priority classifier. */
function labelSignals(message: MailSummary): Signal[] {
  const signals: Signal[] = [];
  if (message.labels.starred) signals.push(add('starred', 'you starred it', 3, STARRED));
  if (message.labels.important) {
    signals.push(add('important', 'Gmail flags it important', 3, IMPORTANT));
  }
  return signals;
}

/**
 * Whether it was written to you, and how many others were on it.
 *
 * Skipped entirely when there is no address to compare against — a missing
 * profile lookup should cost this signal, not the ranking.
 */
function addressingSignals(message: MailSummary, self: string | null): Signal[] {
  // `Delivered-To` names whichever of the user's own addresses Gmail routed
  // this to, so it covers aliases the profile address does not.
  const selves = new Set([...(self ? [self] : []), ...message.deliveredTo]);
  if (selves.size === 0) return [];

  const recipients = message.to.length + message.cc.length;
  const signals: Signal[] = [];

  if (message.to.some((a) => selves.has(a))) {
    const sole = recipients === 1;
    signals.push(add('to', sole ? 'addressed to you alone' : 'addressed to you', 2, TO_DIRECT));
  } else if (message.cc.some((a) => selves.has(a))) {
    signals.push(add('ccOnly', 'you were copied', 2, CC_ONLY));
  } else {
    return signals;
  }

  // Silent: the count refines the phrase chosen above rather than adding a
  // second clause that says the same thing twice.
  if (recipients === 1) signals.push(add('soleRecipient', '', 2, SOLE_RECIPIENT));
  else if (recipients <= GROUP_LIMIT) signals.push(add('smallGroup', '', 2, SMALL_GROUP));

  return signals;
}

/** Whether it continues a conversation rather than starting one. */
function conversationSignals(message: MailSummary): Signal[] {
  const signals: Signal[] = [];
  if (message.threaded) {
    signals.push(add('threaded', 'part of a thread you’re in', 2, THREADED));
  }
  // Silent when `threaded` already said it; speaks when the header was dropped.
  if (/^\s*re:/i.test(message.subject)) {
    signals.push(add('reSubject', message.threaded ? '' : 'a reply to an earlier message', 2, RE_SUBJECT));
  } else if (/^\s*fwd?:/i.test(message.subject)) {
    signals.push(add('fwdSubject', '', 2, FWD_SUBJECT));
  }
  return signals;
}

/** What the message actually asks of you. */
function askSignals(matches: Matches): Signal[] {
  const signals: Signal[] = [];
  if (matches.transactional) {
    signals.push(add('transactional', 'flags action required', 1, TRANSACTIONAL));
  }
  if (matches.request) signals.push(add('request', 'makes a direct request', 1, DIRECT_REQUEST));
  if (matches.questionSubject) {
    signals.push(add('questionSubject', 'asks a direct question', 1, QUESTION_SUBJECT));
  }
  if (matches.deadline) signals.push(add('deadline', 'mentions a deadline', 1, DEADLINE));
  // Silent when the subject already carries a question mark.
  if (matches.questionSnippet) {
    signals.push(
      add('questionSnippet', matches.questionSubject ? '' : 'asks a question', 1, QUESTION_SNIPPET),
    );
  }
  return signals;
}

/** Who the sender is to you, across the whole candidate set. */
function senderSignals(message: MailSummary, context: RankContext): Signal[] {
  const address = senderAddress(message.from);
  if (!address) return [];

  const signals: Signal[] = [];
  if (context.knownSenders?.has(address)) {
    signals.push(add('knownSender', 'you’ve emailed them before', 2, KNOWN_SENDER));
  }
  if ((context.senderCounts?.get(address) ?? 0) >= REPEAT_SENDER_AT) {
    signals.push(add('repeatSender', '', 2, REPEAT_SENDER));
  }
  return signals;
}

/**
 * The bulk and marketing gates.
 *
 * The order of the checks is the argument. Automation alone is not damning —
 * a failed-payment alert is automated, from `no-reply@`, and matters more than
 * almost anything else in the inbox, which is exactly the case a blanket
 * demotion gets wrong. So transactional language cancels the penalty outright,
 * *unless* marketing language is also present: urgency that arrives alongside a
 * discount is a sales tactic, not a consequence.
 */
function automationSignals(message: MailSummary, matches: Matches): Signal[] {
  const signals: Signal[] = [];
  const automated =
    message.listHeaders ||
    message.autoHeaders ||
    message.labels.updates ||
    message.labels.forums ||
    AUTOMATED_SENDER.test(senderAddress(message.from).split('@')[0] ?? '');

  if (automated && !(matches.transactional && !matches.marketing)) {
    signals.push(scale('bulk', message.threaded ? BULK_THREADED_FACTOR : BULK_FACTOR));
  }
  if (matches.marketing) signals.push(scale('marketing', MARKETING_FACTOR));

  return signals;
}

/**
 * Age, as a gentle multiplier.
 *
 * A tie-breaker by construction: the curve spans 1.0 to {@link RECENCY_FLOOR},
 * so it can order two comparable messages but cannot lift a newsletter over a
 * real one. Nothing should ever be picked *because* it is newest.
 */
function recencySignal(message: MailSummary, now: number): Signal {
  const hours = Math.max(0, (now - message.receivedAt) / 3_600_000);
  const factor = RECENCY_FLOOR + (1 - RECENCY_FLOOR) * Math.exp(-hours / RECENCY_DECAY_H);
  return scale('recency', factor);
}

/**
 * Scores one message.
 *
 * @param message - The candidate, as fetched by `fetchInbox`.
 * @param context - Everything the message itself cannot say. See {@link RankContext}.
 * @param now - Epoch ms to measure age against. Injected rather than read, so
 *   the same inbox always scores the same in a test.
 */
export function scoreMail(message: MailSummary, context: RankContext, now: number): Score {
  const matches = readText(message);
  const signals = [
    ...labelSignals(message),
    ...addressingSignals(message, context.self),
    ...conversationSignals(message),
    ...askSignals(matches),
    ...(message.unread ? [add('unread', 'unread', 3, UNREAD)] : []),
    ...senderSignals(message, context),
    ...automationSignals(message, matches),
    recencySignal(message, now),
  ];

  const points = signals.reduce((sum, s) => sum + s.points, 0);
  const factor = signals.reduce((product, s) => product * s.factor, 1);

  return { total: Math.round(points * factor * 10) / 10, signals };
}

/**
 * Builds the panel's one-line reason from the signals that spoke.
 *
 * Takes the top two by narrative tier, and drops to one rather than truncating
 * mid-clause. Gates and silent signals are excluded — a reason should say why
 * the message matters, not recite the arithmetic.
 */
export function reasonFor(signals: Signal[]): string {
  const spoken = signals
    .filter((s) => s.phrase && s.points > 0)
    .sort((a, b) => a.tier - b.tier || b.points - a.points);

  if (spoken.length === 0) return 'Recent in your inbox';

  const joined = spoken.length > 1 ? `${spoken[0].phrase}, ${spoken[1].phrase}` : spoken[0].phrase;
  const line = joined.length > REASON_MAX ? spoken[0].phrase : joined;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/**
 * Ranks every message that clears {@link FLOOR}, most important first.
 *
 * Returns the whole ordering rather than the {@link TOP_N} the panel has room
 * for, because the panel's window into it moves: dismissing a pick promotes the
 * next one, and a ranking cut to three has nothing left to promote. Windowing is
 * therefore the caller's job, and the honest division of labour anyway — this
 * function knows what matters, not how much of it fits on screen.
 *
 * Returning fewer than `TOP_N` — or none — is a correct outcome, not a degraded
 * one: an inbox of newsletters genuinely has nothing to show.
 *
 * @param messages - Candidates, as fetched by `fetchInbox`.
 * @param context - See {@link RankContext}. `senderCounts` is derived here.
 * @param now - Epoch ms to measure age against.
 */
export function rankMail(
  messages: MailSummary[],
  context: RankContext,
  now: number,
): RankedMail[] {
  if (messages.length === 0) return [];

  const senderCounts = new Map<string, number>();
  for (const message of messages) {
    const address = senderAddress(message.from);
    if (address) senderCounts.set(address, (senderCounts.get(address) ?? 0) + 1);
  }

  return messages
    .map((message) => ({ message, ...scoreMail(message, { ...context, senderCounts }, now) }))
    .filter((scored) => scored.total >= FLOOR)
    // Ties break on recency, then on id — never on the order Gmail happened to
    // return, so the same inbox always ranks the same way.
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.message.receivedAt - a.message.receivedAt ||
        a.message.id.localeCompare(b.message.id),
    )
    .map(({ message, total, signals }) => ({
      message,
      reason: reasonFor(signals),
      score: total,
      signals,
    }));
}
